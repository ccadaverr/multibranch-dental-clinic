// Run with the Playwright browser_run_code_unsafe filename option against local
// Vite. Every API/CSRF request is intercepted; no live account or record is used.
async (page) => {
  page.setDefaultTimeout(10000)
  const check = (value, message) => { if (!value) throw Error(message) }
  const services = [
    { id: 'consult', name: 'QA Consultation', category: 'General', status: 'Active', online_booking: 'bookable' },
    { id: 'braces', name: 'QA Braces', category: 'Specialty', status: 'Active', online_booking: 'consultation_first', consultation_service_id: 'consult' },
    { id: 'hidden', name: 'QA Hidden', status: 'Active', online_booking: 'hidden' },
  ]
  const branches = [{ id: 'b1', name: 'QA Bocaue', city: 'Bocaue', address: 'Fixture A' }, { id: 'b2', name: 'QA Guiguinto', city: 'Guiguinto', address: 'Fixture B' }]
  let posts = [], mode = 'invalid', release = null, hold = false
  await page.route('**/sanctum/**', r => r.fulfill({ status: 204 }))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    let data = []
    if (url.pathname === '/api/services') data = services
    if (url.pathname.endsWith('/dependents')) data = [{ id: 'dependent', first_name: 'QA Child', name: 'QA Child', relationship: 'Child' }]
    if (url.pathname.endsWith('/branch-options')) data = { branches }
    if (url.pathname.endsWith('/calendar')) data = { month: '2099-11', today: '2099-11-01', days: [{ date: '2099-11-02', status: 'available' }] }
    if (url.pathname.endsWith('/availability')) data = { slots: [{ start_time: '09:00' }, { start_time: '10:00' }] }
    if (url.pathname === '/api/appointments' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      posts.push({ payload, key: request.headers()['idempotency-key'] })
      if (hold) await new Promise(resolve => { release = resolve })
      if (mode === 'invalid') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'QA slot expired', errors: { start_time: ['QA slot expired'] } }) })
      data = { id: 'qa-record', code: 'QA-001', status: mode === 'confirmed' ? 'Confirmed' : mode === 'expired' ? 'Cancelled' : 'Pending', booking_payment_status: mode === 'held' ? 'held' : 'unpaid', date: payload.date, start_time: payload.start_time, service: { name: 'QA Consultation' }, branch: { name: 'QA Bocaue' } }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
  })
  await page.goto('http://127.0.0.1:5173')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { BookPage } = await import('/src/patient/pages/Book.jsx')
    const shell = document.createElement('div'); shell.className = 'pp-shell'
    shell.innerHTML = '<aside class="pp-side" aria-label="Fixture sidebar"></aside><div class="pp-body"><main class="pp-main" id="r1-fixture"></main></div>'
    document.getElementById('root').style.display = 'none'; document.body.append(shell)
    const el = shell.querySelector('#r1-fixture')
    window.__r1 = { React, ReactDOM, BookPage, el, root: null, toasts: [] }
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, failure) {
      if (window.__r1.geo === 'granted') success({ coords: { latitude: 14.8, longitude: 120.9 } })
      else failure({ code: 1 })
    } } })
  })
  const root = page.locator('#r1-fixture')
  const mount = async prefill => {
    await page.evaluate(prefill => {
      const f = window.__r1; f.root?.unmount(); f.toasts = []
      f.root = f.ReactDOM.createRoot(f.el)
      f.root.render(f.React.createElement(f.BookPage, { prefill, onNavigate() {}, toast: (...args) => f.toasts.push(args) }))
    }, prefill || null)
  }
  const chooseTime = async time => {
    await root.getByRole('gridcell', { name: /Nov 2, 2099/ }).click()
    await root.getByRole('button', { name: time, exact: true }).click()
  }
  const toReview = async () => {
    await mount({ service: 'consult', forPatientId: 'dependent' })
    await root.getByRole('button', { name: /QA Bocaue/ }).click()
    await chooseTime('9:00 AM')
    check(await root.getByRole('button', { name: /Submit booking/ }).isDisabled(), 'payment must be explicit')
    await root.getByRole('radio', { name: 'Pay at the clinic', exact: true }).check()
  }
  const results = []
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const geo of ['granted', 'denied']) {
      await mount({ service: 'consult', forPatientId: 'dependent' })
      await root.getByRole('button', { name: 'Guiguinto', exact: true }).click()
      check(await root.getByRole('button', { name: /QA Bocaue/ }).count() === 0, 'city filter must apply')
      await page.evaluate(g => { window.__r1.geo = g }, geo)
      await root.getByRole('button', { name: 'Find the best branch for me' }).click()
      await root.getByRole('button', { name: 'All', exact: true }).click()
      check(await root.getByRole('button', { name: /QA Bocaue/ }).isVisible(), 'All must restore Bocaue after geolocation')
      check(await root.getByRole('button', { name: /QA Guiguinto/ }).isVisible(), 'All must retain Guiguinto')
      check(await root.getByRole('combobox', { name: 'Booking for' }).inputValue() === 'dependent', 'dependent selection must survive geolocation')
      await root.getByRole('button', { name: /QA Bocaue/ }).click(); await chooseTime('9:00 AM')
      await root.getByRole('button', { name: 'Change branch', exact: true }).click()
      await root.getByRole('button', { name: /QA Guiguinto/ }).click()
      check(await root.getByRole('button', { name: '9:00 AM', exact: true }).count() === 0, 'new branch must clear date/slot')
      await chooseTime('10:00 AM')
      results.push(`${width}: city → ${geo} → All; dependent preserved; branch clears schedule`)
    }
    for (const service of ['consult', 'braces', 'hidden', 'missing']) {
      await mount({ service })
      if (service === 'hidden' || service === 'missing') await root.getByRole('alert').waitFor()
      else {
        await root.getByRole('heading', { name: 'Choose a branch' }).waitFor()
        if (service === 'braces') check((await root.innerText()).includes('you are booking QA Consultation'), 'prefill consultation explanation')
      }
    }
    posts = []; mode = 'invalid'; hold = true
    await toReview()
    const submit = root.getByRole('button', { name: /Submit booking/ })
    await submit.evaluate(el => { el.click(); el.click() })
    await root.getByText(/Checking your booking\./).waitFor()
    await root.getByRole('button', { name: 'Back', exact: true }).click()
    await root.getByRole('button', { name: 'Return to Review' }).click()
    check(await root.getByRole('button', { name: 'Checking booking…', exact: true }).isDisabled(), 'remounted Review must retain in-flight lock')
    check(posts.length === 1 && release, 'rapid confirmation/remount must send one command')
    hold = false; release(); release = null
    await root.getByRole('alert').filter({ hasText: 'QA slot expired' }).waitFor()
    await root.getByRole('button', { name: /Submit booking/ }).click()
    await page.waitForFunction(() => document.querySelector('#r1-fixture [role="alert"]')?.textContent === 'QA slot expired', null, { timeout: 10000 })
    await root.getByRole('button', { name: 'Change time', exact: true }).focus()
    await page.keyboard.press('Enter')
    await root.getByRole('button', { name: '10:00 AM', exact: true }).click()
    mode = 'pending'
    await root.getByRole('button', { name: /Submit booking/ }).click()
    await root.getByRole('heading', { name: 'Pending front-desk confirmation' }).waitFor()
    check(posts.length === 3, 'three sequential attempts expected')
    check(posts[0].key && posts[0].key === posts[1].key && posts[1].key !== posts[2].key, 'same intent retry key / changed time new key')
    check(posts.every(p => p.payload.pay_at_clinic === true && p.payload.for_patient_id === 'dependent' && !p.payload.dentist_ref), 'explicit cash/dependent/server assignment payload')
    check((await page.evaluate(() => window.__r1.toasts)).every(t => t[1] !== 'success'), 'Pending must never produce a success toast')
    check(await root.evaluate(el => el.scrollWidth <= el.clientWidth), 'booking must not overflow')
    results.push(`${width}: rapid confirm + Back/remount lock; stale error; same-key retry; changed intent new key; keyboard; Pending feedback`)
    for (const [state, heading] of [['confirmed', 'QA Child is booked!'], ['held', 'Pending payment verification'], ['expired', 'This booking is no longer active']]) {
      mode = state; await toReview(); await root.getByRole('button', { name: /Submit booking/ }).click()
      await root.getByRole('heading', { name: heading, exact: true }).waitFor()
    }
    results.push(`${width}: Confirmed / held payment / expired feedback`)
  }
  return { passed: results, liveMutations: 0 }
}
