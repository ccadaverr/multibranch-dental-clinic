import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir, writeFile, readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

const baseline = process.argv.includes('--baseline')
const root = process.env.CLIN04_URL || 'http://127.0.0.1:5194'
const evidence = process.env.CLIN04_EVIDENCE_DIR || path.join(os.tmpdir(), 'yzh-clin-04-' + (baseline ? 'before' : 'after'))
const button = (p, name) => p.getByRole('button', {name, exact: true})
const tooth = (p, id) => p.locator('.od-tooth[data-tooth="' + id + '"]')
const note = p => p.getByRole('textbox', {name: /^Note \(optional\)/})
const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
async function boot(p, query = '') {await p.goto(root + '/tests/fixtures/yzh-clin-04.html' + query, {timeout:15000}); await tooth(p, '18').waitFor()}
async function control(p, name) {await p.locator('.od-segmented button').filter({hasText: name}).click()}
async function selected(p, id) {assert.equal(await p.locator('.od-tooth.is-selected').getAttribute('data-tooth'), id)}
async function focusPaint(p) {
  return p.locator('.od-tooth:focus').evaluate(e => {
    const css = getComputedStyle(e), shape = getComputedStyle(e.querySelector('.od-tooth-shape'))
    return {outline: css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 2, stroke: shape.stroke, width: parseFloat(shape.strokeWidth)}
  })
}
const cases = [
  ['H1-selected-state', async p => {
    await boot(p); await tooth(p, '18').focus(); await p.keyboard.press('Enter'); await selected(p, '18')
    assert.equal(await tooth(p, '18').getAttribute('aria-pressed'), 'true', 'selected tooth must be exposed as pressed')
    assert.equal(await tooth(p, '17').getAttribute('aria-pressed'), 'false')
    await control(p, 'Primary (20)'); await tooth(p, '55').focus(); await p.keyboard.press('Space'); await selected(p, '55')
    assert.equal(await tooth(p, '55').getAttribute('aria-pressed'), 'true')
  }],
  ['H1-visible-focus', async p => {
    await boot(p); await button(p, 'Before chart').focus()
    for (let i = 0; i < 10 && !(await p.locator('.od-tooth:focus').count()); i++) await p.keyboard.press('Tab')
    assert.equal(await p.locator('.od-tooth:focus').count(), 1, 'Tab must reach the chart')
    const paint = await focusPaint(p)
    assert(paint.outline || paint.width >= 2.5, 'focused SVG tooth needs a visible outline or focus stroke')
  }],
  ['H1-efficient-navigation', async p => {
    await boot(p); await tooth(p, '18').focus(); await p.keyboard.press('ArrowRight')
    assert(await tooth(p, '17').evaluate(e => e === document.activeElement), 'Right arrow moves focus to adjacent tooth')
    assert.equal(await p.locator('.od-tooth[tabindex="0"]').count(), 1, 'one chart Tab stop')
    await p.keyboard.press('Space'); await selected(p, '17')
    await p.keyboard.press('Tab'); assert.equal(await p.locator('.od-tooth:focus').count(), 0, 'Tab exits chart')
    await tooth(p, '17').focus(); await p.keyboard.press('ArrowDown'); assert(await tooth(p, '47').evaluate(e => e === document.activeElement))
    await p.keyboard.press('Home'); assert(await tooth(p, '18').evaluate(e => e === document.activeElement))
    await p.keyboard.press('End'); assert(await tooth(p, '38').evaluate(e => e === document.activeElement))
    await control(p, 'Primary (20)'); await tooth(p, '55').focus(); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await selected(p, '54')
  }],
  ['H1-summary-focus', async p => {
    await boot(p); await tooth(p, '18').focus(); await p.keyboard.press('Enter')
    await button(p, 'Back to all findings').focus(); await p.keyboard.press('Enter'); await frames(p)
    assert(await tooth(p, '18').evaluate(e => e === document.activeElement), 'removing Back must restore chart focus')
    await control(p, 'Front view'); await tooth(p, '18').focus(); await p.keyboard.press('Space')
    await button(p, 'Back to all findings').focus(); await p.keyboard.press('Enter'); await frames(p)
    assert(await tooth(p, '18').evaluate(e => e === document.activeElement))
  }],
  ['H1-anatomical-description', async p => {
    await boot(p, '?numbering=universal')
    const t = p.getByRole('button', {name: 'Tooth 1: Caries', exact: true}); assert.equal(await t.count(), 1)
    const snapshot = await t.ariaSnapshot()
    const description = await t.evaluate(e => (e.getAttribute('aria-describedby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' '))
    assert.match(description, /FDI 18/); assert.match(description, /patient.?s right/i)
    await t.focus(); await p.keyboard.press('Enter')
    const cdp=await p.context().newCDPSession(p),{root:dom}=await cdp.send('DOM.getDocument')
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:dom.nodeId,selector:'.od-tooth[data-tooth="18"]'})
    const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false}),ax=nodes[0]
    assert.equal(ax.role.value,'button'); assert.equal(ax.name.value,'Tooth 1: Caries'); assert.match(ax.description.value,/FDI 18/)
    assert.equal(ax.properties.find(p=>p.name==='pressed').value.value,'true','platform accessibility tree exposes the pressed tooth')
    await cdp.detach()
    await control(p, 'Primary (20)'); assert.equal(await p.getByRole('button', {name: /^Tooth A/}).count(), 1)
    return {snapshot, description, accessibility:{role:ax.role.value,name:ax.name.value,description:ax.description.value,properties:ax.properties}}
  }],
  ['H2-surface-equivalence', async p => {
    await boot(p); await tooth(p, '18').click()
    for (const s of ['M', 'O', 'D', 'B', 'L']) {const box = p.getByRole('checkbox', {name: s, exact: true}); await box.focus(); await p.keyboard.press('Space'); assert(await box.isChecked())}
    const facets = await p.locator('.surface-diagram-container polygon, .surface-diagram-container rect').evaluateAll(es => es.map(e => e.style.fill))
    assert(facets.every(fill => fill === 'rgb(224, 231, 255)'), 'checkboxes synchronize every SVG facet')
    await note(p).fill('Synthetic draft'); await tooth(p, '21').focus(); await p.keyboard.press('Enter'); await p.getByRole('dialog').getByRole('button', {name: 'Discard changes and continue', exact: true}).click()
    for (const s of ['M', 'O', 'D', 'B', 'L']) assert(!(await p.getByRole('checkbox', {name: s, exact: true}).isChecked()))
    const left = p.locator('.surface-diagram-container polygon').nth(2), right = p.locator('.surface-diagram-container polygon').nth(3)
    await left.click({position:{x:5,y:45}}); assert(await p.getByRole('checkbox',{name:'M',exact:true}).isChecked()); assert(!(await p.getByRole('checkbox',{name:'D',exact:true}).isChecked()))
    await right.click({position:{x:30,y:45}}); assert(await p.getByRole('checkbox',{name:'D',exact:true}).isChecked())
  }],
  ['H2-touch-surfaces-and-targets', async p => {
    await boot(p)
    const measurements=[]
    for(const id of ['18','21','48','31','55','61','85','71']) {
      if(await tooth(p,id).count()===0)await control(p,Number(id[0])>=5?'Primary (20)':'Permanent (32)')
      await tooth(p,id).focus(); await p.keyboard.press('Enter')
      for(const s of ['M','O','D','B','L']) {
        const box=p.getByRole('checkbox',{name:s,exact:true}),r=await box.locator('..').boundingBox()
        assert(r.width>=24&&r.height>=24,'surface checkbox label is a full-size equivalent target'); assert(!(await box.isChecked()),'no surface leaks between teeth')
      }
      const rightSide=[1,4,5,8].includes(Number(id[0]))
      const points=[['B',.5,.16],['L',.5,.84],[rightSide?'D':'M',.16,.5],[rightSide?'M':'D',.84,.5],['O',.5,.5]]
      const svg=p.locator('.surface-diagram-container svg'); await svg.scrollIntoViewIfNeeded(); const r=await svg.boundingBox()
      for(const [s,x,y] of points) {
        const cx=r.x+r.width*x,cy=r.y+r.height*y
        const target=await p.evaluate(({cx,cy})=>{const center=document.elementFromPoint(cx,cy);return {tag:center.tagName,inscribed:[-12,0,12].every(dx=>[-12,0,12].every(dy=>document.elementFromPoint(cx+dx,cy+dy)===center))}},{cx,cy})
        assert(target.inscribed,'facet has an actual inscribed 24px target, rather than relying on its bounding box')
        await p.touchscreen.tap(cx,cy)
        for(const other of ['M','O','D','B','L'])assert.equal(await p.getByRole('checkbox',{name:other,exact:true}).isChecked(),other===s,'tap selects exactly the intended anatomical surface')
        await p.touchscreen.tap(cx,cy); assert(!(await p.getByRole('checkbox',{name:s,exact:true}).isChecked()))
        measurements.push({id,s,inscribed24:target.inscribed})
      }
    }
    return measurements
  }],
  ['H3-truthful-segments', async p => {
    await boot(p); await tooth(p, '18').click(); await note(p).fill('Synthetic draft')
    assert.equal(await p.getByRole('tab').count(), 0, 'segmented action buttons must not declare incomplete tabs')
    await button(p, 'Front view').focus(); await p.keyboard.press('Enter'); await selected(p, '18'); assert.equal(await note(p).inputValue(), 'Synthetic draft')
    assert.equal(await button(p, 'Front view').getAttribute('aria-pressed'), 'true')
    assert.equal(await button(p, 'Top view (Arch)').getAttribute('aria-pressed'), 'false')
    await button(p, 'Primary (20)').focus(); await p.keyboard.press('Space'); await button(p, 'Stay').click(); await selected(p, '18')
  }],
  ['H4-target-equivalent', async p => {
    await boot(p)
    const chooser = p.getByRole('combobox', {name: 'Choose tooth', exact: true})
    assert.equal(await chooser.count(), 1, 'undersized irregular SVG targets require a same-page equivalent')
    const rect = await chooser.boundingBox(); assert(rect.width >= 24 && rect.height >= 24)
    assert.equal(await chooser.locator('option[value]:not([value=""])').count(), 32)
    await chooser.selectOption('18'); await selected(p, '18'); assert.equal(await chooser.inputValue(), '18')
    await chooser.selectOption('17'); await selected(p, '17')
    await control(p, 'Primary (20)'); assert.equal(await chooser.locator('option[value]:not([value=""])').count(), 20)
    await chooser.selectOption('54'); await selected(p, '54')
    return rect
  }],
  ['H4-target-spacing', async p => {
    await boot(p)
    const spacing = await p.locator('.od-tooth .od-tooth-shape').evaluateAll(es => {
      const boxes = es.map(e => {const r=e.getBoundingClientRect(); return {tooth:e.closest('[data-tooth]').dataset.tooth,x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})
      const small = boxes.filter(r => r.width < 24 || r.height < 24), overlaps=[]
      for(let i=0;i<small.length;i++)for(let j=i+1;j<small.length;j++){const a=small[i],b=small[j],distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance<24)overlaps.push({a:a.tooth,b:b.tooth,distance})}
      return {boxes,undersized:small.length,overlaps}
    })
    if(spacing.overlaps.length)assert.equal(await p.getByRole('combobox',{name:'Choose tooth',exact:true}).count(),1,'undersized targets have intersecting 24px spacing circles and need an equivalent')
    return spacing
  }],
  ['H4-touch-geometry', async p => {
    await boot(p)
    const geometries = []
    for (const dentition of ['Permanent (32)', 'Primary (20)']) for (const view of ['Top view (Arch)', 'Front view']) {
      await control(p, dentition); await control(p, view)
      const positions = await p.locator('.od-tooth').evaluateAll(es => es.map(e => {
        const shape = e.querySelector('.od-tooth-shape'), r = shape.getBoundingClientRect()
        return {id:e.dataset.tooth, x:r.x+r.width/2, y:r.y+r.height/2, width:r.width, height:r.height, hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-tooth]')?.dataset.tooth}
      }))
      for (const pos of positions) {assert.equal(pos.hit, pos.id, 'tooth center must never activate a neighbor'); await p.touchscreen.tap(pos.x,pos.y); await selected(p,pos.id)}
      geometries.push({dentition,view,positions})
    }
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    return geometries
  }],
  ['H4-narrow-zoom-layout', async p => {
    await boot(p)
    // A 390px viewport at 200% browser zoom has approximately 195 CSS px.
    await p.setViewportSize({width:195,height:1200})
    const chooser=p.getByRole('combobox',{name:'Choose tooth',exact:true})
    await chooser.selectOption('18'); await selected(p,'18'); await chooser.selectOption('17'); await selected(p,'17')
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'200% zoom-equivalent layout must reflow without page overflow')
  }],
  ['H5-modal-safety', async p => {
    await boot(p); await tooth(p,'18').click(); await note(p).fill('Synthetic A')
    await tooth(p,'17').focus(); await p.keyboard.press('Enter'); const dialog=p.getByRole('dialog',{name:'Leave this tooth?',exact:true}); await dialog.waitFor()
    assert(await button(p,'Stay').evaluate(e=>e===document.activeElement),'safe initial focus is Stay'); assert.match(await dialog.innerText(),/Unsaved changes for Tooth 18/)
    await tooth(p,'18').evaluate(e=>e.focus()); assert(await dialog.evaluate(e=>e.contains(document.activeElement)),'modal blocks background focus')
    for(let i=0;i<8;i++){await p.keyboard.press('Tab'); assert(await dialog.evaluate(e=>e.contains(document.activeElement)||document.activeElement===document.body),'native modal must never focus an underlying control')}
    await p.keyboard.press('Escape'); assert.equal(await dialog.count(),0); assert.equal(await note(p).inputValue(),'Synthetic A'); await selected(p,'18')
    assert(await tooth(p,'17').evaluate(e=>e===document.activeElement),'Escape restores invoking tooth')
    await p.keyboard.press('Enter'); await button(p,'Stay').click(); assert.equal(await note(p).inputValue(),'Synthetic A')
    await p.keyboard.press('Space'); await button(p,'Discard changes and continue').click(); await selected(p,'17'); assert.equal(await note(p).inputValue(),'')
  }],
  ['H5-confirm-once', async p => {
    await boot(p); await tooth(p,'18').click(); await note(p).fill('Synthetic A'); await tooth(p,'17').click()
    await button(p,'Discard changes and continue').evaluate(e=>{e.click();e.click()}); await selected(p,'17')
    assert.deepEqual(await p.evaluate(()=>window.clin04Selections),['18','17'],'one intentional confirmation applies exactly one transition')
  }],
  ['H5-chooser-draft-boundary', async p => {
    await boot(p); const chooser=p.getByRole('combobox',{name:'Choose tooth',exact:true})
    await chooser.selectOption('18'); await note(p).fill('Synthetic A'); await p.getByRole('checkbox',{name:'M',exact:true}).check()
    await chooser.focus(); await chooser.selectOption('17'); await button(p,'Stay').click()
    assert.equal(await chooser.inputValue(),'18'); assert.equal(await note(p).inputValue(),'Synthetic A'); assert(await p.getByRole('checkbox',{name:'M',exact:true}).isChecked())
    assert(await chooser.evaluate(e=>e===document.activeElement),'Stay restores the native chooser')
    await chooser.selectOption('17'); await button(p,'Discard changes and continue').click()
    assert.equal(await chooser.inputValue(),'17'); await selected(p,'17'); assert.equal(await note(p).inputValue(),''); assert(!(await p.getByRole('checkbox',{name:'M',exact:true}).isChecked()))
    assert(await chooser.evaluate(e=>e===document.activeElement),'Discard keeps native chooser focus')
  }],
  ['H5-discard-back-focus', async p => {
    await boot(p); await tooth(p,'18').click(); await note(p).fill('Synthetic A')
    await button(p,'Back to all findings').focus(); await p.keyboard.press('Enter'); await button(p,'Discard changes and continue').click(); await frames(p)
    assert(await tooth(p,'18').evaluate(e=>e===document.activeElement),'discard to summary returns focus to a surviving chart control')
  }],
  ['read-only', async p => {
    for(const role of ['staff','patient']){await boot(p,'?role='+role); await tooth(p,'18').click(); assert.equal(await p.locator('.od-record-form, .tc-surfaces input').count(),0); await p.locator('.surface-diagram-container polygon').first().click(); assert.deepEqual(await p.evaluate(()=>window.clin04Records),[]); await control(p,'Front view'); await selected(p,'18')}
  }],
  ['clean-reverted', async p => {
    await boot(p); await tooth(p,'18').click(); await note(p).fill('Synthetic'); await note(p).fill(''); await tooth(p,'17').click(); assert.equal(await p.getByRole('dialog').count(),0); await selected(p,'17')
  }],
]
const browser=await chromium.launch({channel:'chrome',headless:true}), results=[]
await mkdir(evidence,{recursive:true})
try {
  const filter=process.argv.find(a=>a.startsWith('--case='))?.slice(7)
  for(const width of baseline?[390]:[390,768,1024,1440]) for(const [name,run] of cases.filter(([name])=>!filter||name===filter)) {
    const context=await browser.newContext({viewport:{width,height:1200},hasTouch:true}),p=await context.newPage(),errors=[]
    p.setDefaultTimeout(2000); p.on('pageerror',e=>errors.push(e.message))
    // A fixture may never fall through to a real API or external service.
    await p.route('**/api/**',r=>r.abort())
    try {const detail=await run(p); assert.deepEqual(errors,[]); results.push({width,name,status:'pass',detail}); console.log('PASS '+width+' '+name)}
    catch(e){results.push({width,name,status:'fail',error:e.message,stack:e.stack,active:await p.evaluate(()=>({tag:document.activeElement?.tagName,tooth:document.activeElement?.getAttribute('data-tooth'),name:document.activeElement?.getAttribute('aria-label')})),pageErrors:errors}); console.log('FAIL '+width+' '+name+': '+e.message)}
    finally {await context.close()}
  }
  const hashes={}
  for(const name of ['Odontogram.jsx','SurfaceDiagram.jsx','ToothTimeline.jsx','ChartSummary.jsx','odontogram.css']) {
    const file='src/components/odontogram/'+name
    hashes[file]=createHash('sha256').update(baseline?execFileSync('git',['show','202e7293ded3a1cf64135a69f4a3f90bf119e67a:'+file]):await readFile(file)).digest('hex')
  }
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,baseline,hashes,results},null,2))
  console.log(JSON.stringify({passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,evidence}))
  if(results.some(r=>r.status==='fail'))process.exitCode=1
} finally {await browser.close()}
