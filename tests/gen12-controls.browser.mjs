import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { INITIAL_BRANCHES, INITIAL_DENTISTS, INITIAL_SERVICES, INITIAL_STAFF } from '../src/data.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5499'
const output = process.env.QA_OUTPUT || 'gen12-evidence'
const browser = await chromium.launch({ channel: 'chrome' })
const widths = (process.env.QA_WIDTHS || '375,390,430,768,1024,1440').split(',').map(Number)
const results = []
const failures = []
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh'
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => type => type
window.__vite_plugin_react_preamble_installed__ = true
</script>
<script type="module" src="/tests/fixtures/gen12-controls.jsx"></script></html>`

function check(condition, label) {
  if (!condition) failures.push(label)
}

async function checkGeometry(page, selector, label, { target, font, contrast = false } = {}) {
  const value = await page.locator(selector).evaluateAll(elements => {
    const rgba = value => (value.match(/[\d.]+/g) || []).map(Number)
    const luminance = values => values.slice(0,3).map(v => v/255).reduce((sum,v,i) =>
      sum + [0.2126,0.7152,0.0722][i] * (v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4), 0)
    const blend = (fg,bg,a) => fg.slice(0,3).map((value,i) => value*a + bg[i]*(1-a))
    const background = el => {
      if (!el) return [255,255,255]
      const color = rgba(getComputedStyle(el).backgroundColor)
      return color.length===3 ? color : blend(color,background(el.parentElement),color[3] ?? 0)
    }
    const rects = elements.filter(el => el.checkVisibility({ checkVisibilityCSS: true })).map(el => {
      const r = el.getBoundingClientRect(), css = getComputedStyle(el)
      const text = el.querySelector('.btn > span') || el
      const bg = background(el.parentElement), fill = rgba(css.backgroundColor), fg = rgba(css.color), opacity = Number(css.opacity)
      const buttonBg = blend(fill, bg, fill[3] ?? 1)
      const lums = [luminance(blend(fg, bg, opacity)), luminance(blend(buttonBg, bg, opacity))].sort((a,b)=>a-b)
      return { label: el.getAttribute('aria-label') || el.textContent.trim(), width: r.width, height: r.height,
        x: r.x, y: r.y, contrast: (lums[1]+.05)/(lums[0]+.05), hasText: !!el.textContent.trim(), font: parseFloat(css.fontSize), clipped: text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1 }
    }).filter(r => r.width && r.height)
    return { rects, viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }
  })
  check(value.rects.length > 0, `${label} no sampled controls`)
  check(value.content <= value.viewport + 1, `${label} page overflow ${value.content}/${value.viewport}`)
  for (const [i, r] of value.rects.entries()) {
    check(!!r.label, `${label} unnamed control`)
    check(!r.clipped, `${label} clipped ${r.label}`)
    if (target) check(Math.min(r.width, r.height) >= target - .5, `${label} target ${r.label} ${r.width}×${r.height}`)
    if (contrast && r.hasText) check(r.contrast >= 4.5, label + ' contrast ' + r.label + ' ' + r.contrast.toFixed(2))
    if (font && r.hasText) check(r.font >= font - .01, `${label} font ${r.label} ${r.font}`)
    for (const other of value.rects.slice(i + 1)) {
      const overlapX = Math.min(r.x + r.width, other.x + other.width) - Math.max(r.x, other.x)
      const overlapY = Math.min(r.y + r.height, other.y + other.height) - Math.max(r.y, other.y)
      check(overlapX <= .5 || overlapY <= .5, `${label} overlap ${r.label} / ${other.label}`)
    }
  }
  results.push({ label, ...value })
}

const branch = INITIAL_BRANCHES[0]
const branches = [{id:branch.id,public_id:'01k00000000000000000000001',branch_code:branch.branchCode,name:branch.name,
  city:branch.city,address:branch.address,phone:branch.phone,open_time:branch.open,close_time:branch.close,status:'Open'}]
const dentists = INITIAL_DENTISTS.slice(0, 1).map(d => ({...d,branch_ids:[branch.id],service_ids:INITIAL_SERVICES.map(s => s.id)}))
const staff = INITIAL_STAFF.map(person => ({...person, title:person.staffType, branchId:branch.id}))
const services = INITIAL_SERVICES.map(s => ({id:s.id,code:s.code,name:s.name,duration_minutes:s.duration,category:s.category,status:s.status}))

async function openPage(page, name) {
  const target = page.getByRole('button', { name, exact: true }).filter({ visible: true })
  if (!await target.count()) await page.getByRole('button', { name: 'Open navigation' }).click()
  await target.first().click()
}

async function checkRole(width, role) {
  const touch = width <= 768
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, reducedMotion: 'reduce' })
  try {
    await context.route('**/sanctum/**', route => route.fulfill({ status: 204 }))
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      const patientId = '01k00000000000000000000012'
      const me = { id:'01k00000000000000000000011', role, name:'Synthetic Workspace User', email:role==='staff'?'staff.reception@example.test':role+'@example.test', account_status:'Active',
        branch_scopes:[{id:branch.id,name:branch.name}], patient:role==='patient'?{id:patientId,code:'PAT-QA'}:null,
        dentist:role==='dentist'?{id:dentists[0].id,branch_scopes:[{id:branch.id}]}:null }
      const rows = { '/api/me':me, '/api/branches':branches, '/api/public/branches':branches, '/api/services':services, '/api/dentists':dentists, '/api/staff':staff,
        '/api/appointments':[], '/api/notifications':[], '/api/queue/mine':[], '/api/queue':[] }
      return route.fulfill({ json: {data:rows[path] ?? [], meta:{current_page:1,last_page:1}} })
    })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(e.message))
    await page.goto(base + (role==='patient' ? '/#p/visits' : '/#sign-in'))
    const label = role + " " + width
    const metrics = { target:touch ? 44 : 32, font:13 }
    if (role === 'patient') {
      const book = page.locator('main').getByRole('button', {name:'Book a visit',exact:true}).first()
      await book.waitFor()
      await checkGeometry(page, '.pp-bottom .pp-tab, main .pp-tabs button, main .pp-page-head .btn', label, metrics)
      await book.press('Enter')
      await page.waitForURL('**/#p/book')
    } else {
      await page.locator('.workspace-label').waitFor().catch(error => { throw new Error(label + ': ' + error.message) })
      if (role === 'owner') {
        await openPage(page, 'Dentist & Staff')
        const refresh = page.getByRole('button', {name:'Refresh duty'})
        await refresh.waitFor()
        await checkGeometry(page, '.page-header-right button', label, metrics)
        await refresh.press('Space')
        assert.equal(await refresh.getAttribute('aria-busy'), 'true')
        await openPage(page, 'Branches')
        await page.getByRole('heading', {name:'Multi-Branch Clinic Management'}).waitFor()
      } else if (role === 'staff') {
        const agenda = page.locator('.content').getByRole('button',{name:'View all appointments',exact:true})
        await agenda.waitFor()
        await checkGeometry(page, '.content .card-actions .btn', label + ' dashboard', metrics)
        await agenda.press('Enter')
        const trigger = page.getByRole('button', {name:'New appointment',exact:true})
        await trigger.waitFor()
        await checkGeometry(page, '.page-header-right button', label, metrics)
        await trigger.press('Enter')
        const dialog = page.getByRole('dialog', {name:'Create appointment'})
        await dialog.waitFor()
        assert.ok(await dialog.getByRole('button',{name:'Close Create appointment'}).isVisible())
        await checkGeometry(page, 'dialog[open] button.icon-btn, dialog[open] button.btn', label + ' appointment dialog', metrics)
        await page.keyboard.press('Escape')
        assert.ok(await trigger.evaluate(el => el === document.activeElement))
        assert.equal(await page.getByRole('button',{name:'Branches',exact:true}).count(),0)
        await openPage(page, 'Live Queue')
        await page.getByRole('heading',{name:'Patient Queue',exact:true}).waitFor()
      } else {
        const agenda = page.locator('.den-today-agenda').getByRole('button',{name:'My Schedule',exact:true})
        await agenda.waitFor()
        await checkGeometry(page, '.den-today-agenda .card-actions .btn, .den-followup-panel .card-actions .btn, .den-waiting-panel .card-actions .btn', label + ' dashboard', metrics)
        await agenda.press('Space')
        const next = page.getByRole('button', {name:'Next day'})
        await next.waitFor()
        await checkGeometry(page, '.den-day-controls button, .den-page-heading .refresh-btn, .den-month-heading button, .den-week > button', label, metrics)
        const date = page.locator('.den-day-heading time')
        const previous = await date.getAttribute('datetime')
        await next.press('Space')
        assert.notEqual(await date.getAttribute('datetime'), previous)
        await page.getByRole('button', {name:'Today',exact:true}).click()
        assert.equal(await date.getAttribute('datetime'), previous)
      }
    }
    assert.deepEqual(pageErrors, [])
  } finally {
    await context.close()
  }
}

try {
  for (const width of widths) {
    const touch = width <= 768
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, reducedMotion: 'reduce' })
    await context.route('**/gen12-fixture', route => route.fulfill({ contentType: 'text/html', body: fixture }))
    const page = await context.newPage()
    await page.goto(base + '/gen12-fixture')
    const compact = page.getByRole('button', { name: 'Compact action' })
    await compact.waitFor()
    if (process.env.QA_TEXT_ZOOM) await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await checkGeometry(page, 'button[data-sample]', `Shared controls ${width}`, { target: touch ? 44 : 32, font: 13, contrast: true })
    await page.keyboard.press('Tab')
    await compact.focus()
    const ring = await compact.evaluate(el => ({ visible: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }))
    assert.ok(ring.visible && ring.style !== 'none' && ring.width >= 2, 'keyboard focus ring is visible')
    await compact.press('Enter')
    await compact.press('Space')
    assert.equal(await page.locator('output').textContent(), '2')
    if (touch) {
      await compact.tap()
      assert.equal(await page.locator('output').textContent(), '3')
    }
    const refresh = page.getByRole('button', { name: 'Refresh appointments' })
    assert.equal(await refresh.getAttribute('aria-busy'), 'false')
    await refresh.click()
    assert.equal(await refresh.getAttribute('aria-busy'), 'true')
    assert.ok(await refresh.isDisabled())
    assert.ok(await page.getByRole('button', { name: 'Unavailable action' }).isDisabled())
    const search = page.getByRole('searchbox', { name: 'Search appointments' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    assert.equal(await search.inputValue(), '')
    assert.ok(await search.evaluate(el => el === document.activeElement))
    const trigger = page.getByRole('button', { name: 'Review cancellation' })
    await trigger.focus()
    await trigger.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Confirm cancellation?' })
    await dialog.waitFor()
    assert.ok(await dialog.getByRole('button', { name: 'Keep appointment' }).evaluate(el => el === document.activeElement), 'confirmation focuses safe action')
    await checkGeometry(page, 'dialog[open] button', `Confirm dialog ${width}`, { target: touch ? 44 : 32 })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await trigger.evaluate(el => el === document.activeElement), 'Escape restores focus to the trigger')
    await trigger.press('Space')
    await dialog.getByRole('button', { name: 'Cancel appointment' }).click()
    assert.equal(await page.locator('output').textContent(), touch ? '4' : '3')
    await context.close()
  }
  if (process.env.QA_ROLES !== 'none') {
    for (const width of widths) {
      for (const role of (process.env.QA_ROLES || 'owner,staff,dentist,patient').split(',')) await checkRole(width, role)
    }
  }
} finally {
  await browser.close()
  await mkdir(output, { recursive: true })
  await writeFile(output + '/results.json', JSON.stringify({ results, failures }, null, 2))
}
assert.deepEqual(failures, [])
console.log(JSON.stringify({ samples: results.length, failures: failures.length }))
