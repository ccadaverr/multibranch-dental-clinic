import assert from 'node:assert/strict'

// Run through the connected Playwright browser. All API responses are synthetic.
export async function runPersonnelAcceptance(page, base = 'http://127.0.0.1:5182') {
  page.setDefaultTimeout(7000)
  const results = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  const fresh = async (role = 'owner', pageKey = 'dashboard') => {
    await page.goto(`${base}/tests/fixtures/aud01-personnel.html?role=${role}&page=${pageKey}`)
    await page.waitForFunction(() => window.personnel?.go)
  }
  const button = name => page.getByRole('button', {name, exact:true})
  const dialog = () => page.getByRole('dialog', {name:'Edit dentist profile', exact:true})
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no page-level horizontal scrolling')
  const openMenu = async width => { if (width <= 1024) await button('Open navigation').click() }
  const entry = () => button('Dentist & Staff')
  const openPersonnel = async width => {
    await openMenu(width)
    await entry().focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', {name:'Dentist & Staff Management', exact:true}).waitFor()
  }
  for (const width of [375,430,768,1024,1440]) {
    await page.setViewportSize({width, height:900})
    await fresh()
    await openMenu(width)
    assert.equal(await entry().count(), 1, 'exactly one personnel entry is exposed in the active navigation')
    const visibleEntry = width <= 1024 ? page.getByRole('dialog', {name:'Your workspace', exact:true}).getByRole('button', {name:'Dentist & Staff', exact:true}) : entry()
    const target = await visibleEntry.boundingBox()
    assert.ok(target.width >= 44 && target.height >= 40, 'existing navigation target remains usable')
    await page.keyboard.press('Tab')
    await visibleEntry.focus()
    assert.equal(await visibleEntry.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), true, 'visible keyboard focus')
    await page.keyboard.press('Enter')
    await page.getByRole('heading', {name:'Dentist & Staff Management', exact:true}).waitFor()
    if (width <= 1024) assert.equal(await page.getByRole('dialog', {name:'Your workspace', exact:true}).count(), 0)
    await noOverflow()
    await button('Edit Profile').first().focus(); await page.keyboard.press('Enter')
    await dialog().waitFor()
    assert.equal(await dialog().getByRole('checkbox', {name:/^Available for scheduling/}).count(), 1, 'availability control is named')
    assert.equal(await dialog().getByRole('combobox', {name:'Branch', exact:true}).count(), 1, 'branch control is named')
    await button('Save & Synchronize Profile').scrollIntoViewIfNeeded()
    const saveTarget = await button('Save & Synchronize Profile').boundingBox()
    assert.ok(saveTarget.y >= 0 && saveTarget.y + saveTarget.height <= 900, 'save remains reachable inside the scrolling dialog')
    await noOverflow()
    await page.keyboard.press('Escape')
    assert.equal(await dialog().count(), 0)
    assert.equal(await button('Edit Profile').first().evaluate(el => el === document.activeElement), true, 'profile dialog restores focus')
    await page.getByRole('button', {name:/^Staff\d/}).click()
    await page.getByRole('heading', {name:'Clinic Staff profiles', exact:true}).waitFor()
    await button('Edit Profile').first().click()
    await page.getByRole('dialog', {name:'Edit staff profile', exact:true}).waitFor()
    await noOverflow(); await page.keyboard.press('Escape')
    for (const role of ['staff','dentist','patient']) {
      await fresh(role, 'team')
      if (role !== 'patient') await openMenu(width)
      assert.equal(await entry().count(), 0, `${role} cannot discover restricted personnel`)
      assert.equal(await button('Edit Profile').count(), 0, `${role} cannot open profile actions`)
      assert.equal(await page.getByRole('heading', {name:'Dentist & Staff Management', exact:true}).count(), 0)
      await noOverflow()
    }
    results.push({width, ownerNavigation:'pass', restrictedRoles:'pass', dentistAndStaffDialogs:'pass', keyboardFocus:'pass', overflow:'none', target:{width:target.width,height:target.height}})
  }
  await page.setViewportSize({width:1440,height:900}); await fresh(); await openPersonnel(1440)
  await button('Edit Profile').first().click()
  await dialog().getByLabel('Specialty', {exact:true}).fill('Synthetic retained draft')
  await dialog().getByRole('checkbox', {name:/^Available for scheduling/}).uncheck()
  await page.evaluate(() => { window.personnel.fail = true })
  await button('Save & Synchronize Profile').click()
  await page.getByText('Synthetic save refused', {exact:true}).waitFor()
  assert.equal(await dialog().getByLabel('Specialty', {exact:true}).inputValue(), 'Synthetic retained draft')
  await page.evaluate(() => { window.personnel.fail = false; window.personnel.hold = true })
  await button('Save & Synchronize Profile').click()
  await page.waitForFunction(() => window.personnel.writes.length === 2)
  assert.equal(await dialog().count(), 1, 'pending save keeps the form available')
  await page.evaluate(() => window.personnel.writes[1].release())
  await page.getByText('Personnel changes saved.', {exact:true}).waitFor()
  assert.equal(await dialog().count(), 0)
  assert.equal(await page.evaluate(() => window.personnel.state.dentists[0].available), false)
  assert.equal(await page.evaluate(() => window.personnel.writes.every(w => w.path.startsWith('/api/dentists/') && !('service_ids' in w.body))), true)
  await page.evaluate(() => window.personnel.empty())
  await page.getByText('No records found.', {exact:true}).waitFor()
  assert.equal(await button('Edit Profile').count(), 0)
  assert.deepEqual(errors, [], 'no browser runtime errors')
  results.push({save:'synthetic validation failure, retained draft, pending response and successful retry passed', empty:'pass', runtimeErrors:errors})
  return results
}

// The real App entry/routing and reference-data bootstrap, with transport interception.
// No request is sent to a Laravel server; this does not certify backend execution.
export async function runPersonnelAppAcceptance(page, base = 'http://127.0.0.1:5182') {
  await page.goto(`${base}/tests/fixtures/aud01-personnel.html`)
  const catalog = await page.evaluate(async () => {
    const d = await import('/src/data.js')
    return {
      '/api/branches':d.INITIAL_BRANCHES.map(b => ({id:b.id, name:b.name, branch_code:b.branchCode, city:b.city, address:b.address, phone:b.phone, open_time:b.open, close_time:b.close, status:b.status, capacity_threshold:b.threshold})),
      '/api/services':d.INITIAL_SERVICES.map(s => ({id:s.id, name:s.name, code:s.code, duration_minutes:s.duration, category:s.category, status:s.status})),
      '/api/branch-services':d.INITIAL_BRANCH_SERVICES.map(b => ({branch_ref:b.branchId, service_ref:b.serviceId, active:b.active})),
      '/api/dentists':d.INITIAL_DENTISTS.map(x => ({id:x.id, userId:x.userId, personId:x.personId, branch_ids:['b1'], shiftStart:x.shiftStart, shiftEnd:x.shiftEnd, available:x.available, service_ids:[]})),
      '/api/staff':d.INITIAL_STAFF.map(s => ({id:s.id, userId:s.userId, personId:s.personId, title:s.staffType, branchId:s.branchId || 'b1', shiftStart:s.shiftStart, shiftEnd:s.shiftEnd, available:s.available})),
    }
  })
  let role = 'owner', failReference = false, holdReference = false, releaseReference
  const mutations = [], errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const handler = async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') { mutations.push(path); return route.fulfill({status:403, json:{message:'Synthetic mutation denied'}}) }
    if (path === '/api/branches' && holdReference) await new Promise(resolve => { releaseReference = resolve })
    if (path === '/api/branches' && failReference) return route.fulfill({status:503, json:{message:'Synthetic reference load failed'}})
    const emails = {owner:'owner@example.test', staff:'staff.reception@example.test', dentist:'dentist@example.test'}
    return route.fulfill({status:200, json:{data:path === '/api/me' ? {id:`synthetic-app-${role}`, role, email:emails[role], account_status:'Active', branch_scopes:[{id:'b1'}]} : catalog[path] || [], unread_count:0}})
  }
  await page.route('**/api/**', handler)
  const results = []
  try {
    await page.setViewportSize({width:1440, height:900})
    for (const current of ['owner','staff','dentist']) {
      role = current
      await page.goto(`${base}/?open=team#team`)
      await page.locator('.main-nav').waitFor()
      assert.equal(await page.getByRole('heading', {name:'Dentist & Staff Management', exact:true}).count(), 0, 'unsupported URL does not select personnel')
      assert.equal(await page.getByRole('button', {name:'Dentist & Staff', exact:true}).count(), current === 'owner' ? 1 : 0)
      if (current === 'owner') {
        await page.getByRole('button', {name:'Dentist & Staff', exact:true}).click()
        await page.getByRole('heading', {name:'Dentist & Staff Management', exact:true}).waitFor()
        await page.getByRole('button', {name:'Edit Profile', exact:true}).first().click()
        await page.getByRole('dialog', {name:'Edit dentist profile', exact:true}).waitFor()
        await page.keyboard.press('Escape')
      }
      results.push({role:current, directUrl:'no personnel deep link supported; no bypass', menu:current === 'owner' ? 'real TeamPage opens' : 'personnel absent'})
    }
    role = 'owner'; holdReference = true
    await page.reload()
    await page.getByText('Loading your clinic workspace…', {exact:true}).waitFor()
    const deadline = Date.now() + 5000
    while (!releaseReference && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(typeof releaseReference, 'function', 'reference request can be released')
    holdReference = false; releaseReference()
    await page.getByRole('button', {name:'Dentist & Staff', exact:true}).waitFor()
    failReference = true; await page.reload()
    await page.getByRole('heading', {name:'Couldn’t load clinic data', exact:true}).waitFor()
    failReference = false; await page.getByRole('button', {name:'Try again', exact:true}).click()
    await page.getByRole('button', {name:'Dentist & Staff', exact:true}).waitFor()
    assert.deepEqual(mutations, [], 'navigation and URL checks send no mutation')
    assert.deepEqual(errors, [], 'real App has no runtime errors')
    results.push({referenceLoading:'pass', referenceErrorRetry:'pass', mutations:0, runtimeErrors:errors})
    return results
  } finally {
    // Unmount App while interception still covers its outstanding reads.
    await page.goto('about:blank')
    await page.unroute('**/api/**', handler)
    page.off('pageerror', onError)
  }
}
