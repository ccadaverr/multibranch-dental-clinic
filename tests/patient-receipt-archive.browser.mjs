import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5197'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const invoice = {
  id: 'older-invoice', invoice_number: 'INV-OLDER', branch: { name: 'Synthetic branch' },
  receipt: { number: 'RCPT-OLDER', issued_at: '2026-09-28', amount: '304.01', method: 'Cash' },
}
const booking = {
  id: 'older-booking', code: 'APT-OLDER', date: '2026-09-28', status: 'Cancelled',
  booking_payment_status: 'paid', booking_fee_php: '129.99', booking_payment_method: 'GCash',
}

try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(6000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let failInvoices = false
    let emptyBooking = true
    let failBookings = true
    let firstInvoiceCalls = 0
    let olderInvoiceCalls = 0
    let holdInvoicePage
    let releaseInvoicePage
    const held = new Promise(resolve => { holdInvoicePage = resolve })
    let unmountDuringRequest = false
    const pdfPaths = []

    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/receipt-pdf')) {
        pdfPaths.push(url.pathname)
        return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4 synthetic' })
      }
      if (url.pathname === '/api/invoices/mine') {
        if (!url.searchParams.has('cursor')) {
          firstInvoiceCalls++
          const more = failInvoices || !emptyBooking
          return route.fulfill({ json: { data: more ? [{ id: 'older-page' }] : [], meta: { next_cursor: more ? 'older-page' : null } } })
        }
        assert.equal(url.searchParams.get('cursor'), 'older-page')
        olderInvoiceCalls++
        if (failInvoices) return route.fulfill({ status: 503, json: { message: 'Synthetic invoice outage' } })
        await new Promise(resolve => { releaseInvoicePage = resolve; holdInvoicePage() })
        const nextCursor = unmountDuringRequest ? invoice.id : null
        return route.fulfill({ json: { data: [invoice], meta: { next_cursor: nextCursor } } })
      }
      if (url.pathname === '/api/appointments') {
        if (failBookings) return route.fulfill({ status: 503, json: { message: 'Synthetic booking outage' } })
        const isOlderPage = url.searchParams.get('page') === '2'
        return route.fulfill({ json: { data: isOlderPage ? [booking] : [], meta: { last_page: emptyBooking ? 1 : 2 } } })
      }
      return route.fulfill({ json: { data: [] } })
    })

    await page.goto(`${base}/tests/fixtures/patient-receipt-archive.html`)
    const receipts = page.getByRole('tab', { name: /Past Receipts/ })
    await receipts.click()
    const section = page.locator('section[aria-labelledby="archive-receipts-heading"]')
    await section.getByRole('alert').getByText('Booking deposit receipts could not be loaded.').waitFor()
    assert.equal(await section.getByText('No archived receipts').count(), 0)

    failBookings = false
    emptyBooking = false
    failInvoices = true
    const retry = section.getByRole('button', { name: 'Try again' })
    await retry.focus()
    await page.keyboard.press('Enter')
    await section.getByRole('alert').getByText('Invoice receipts could not be loaded.').waitFor()
    await section.getByRole('heading', { name: 'Deposit Ref #DEP-APT-OLDER' }).waitFor()
    assert.equal(olderInvoiceCalls, 1)

    failInvoices = false
    await retry.focus()
    await page.keyboard.press('Enter')
    await held
    await section.getByLabel('Loading receipts').waitFor()
    assert.equal(await retry.count(), 0)
    assert.equal(firstInvoiceCalls, 3)
    releaseInvoicePage()
    await section.getByRole('heading', { name: 'Invoice #INV-OLDER' }).waitFor()
    assert.equal(await section.getByRole('alert').count(), 0)
    await page.getByRole('tab', { name: 'Past Receipts (2)' }).waitFor()
    await section.getByText(/304\.01/).waitFor()
    await section.getByText(/129\.99/).waitFor()
    assert.equal(olderInvoiceCalls, 2)

    for (const heading of ['Invoice #INV-OLDER', 'Deposit Ref #DEP-APT-OLDER']) {
      const row = section.getByRole('listitem').filter({ has: page.getByRole('heading', { name: heading }) })
      const download = page.waitForEvent('download')
      await row.getByRole('button', { name: 'Download Receipt' }).click()
      await download
    }
    assert.deepEqual(pdfPaths, ['/api/invoices/older-invoice/receipt-pdf', '/api/appointments/older-booking/receipt-pdf'])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

    unmountDuringRequest = true
    const startedBeforeUnmount = new Promise(resolve => { holdInvoicePage = resolve })
    let latePageRequests = 0
    await page.route('**/api/invoices/mine?**', route => {
      if (new URL(route.request().url()).searchParams.get('cursor') !== invoice.id) return route.fallback()
      latePageRequests++
      return route.fulfill({ json: { data: [], meta: { next_cursor: null } } })
    })
    await page.reload()
    await startedBeforeUnmount
    await page.evaluate(() => window.unmountArchive())
    const response = page.waitForResponse(r => new URL(r.url()).searchParams.get('cursor') === 'older-page')
    releaseInvoicePage()
    await (await response).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(latePageRequests, 0)

    emptyBooking = true
    await page.reload()
    await receipts.click()
    await section.getByText('No archived receipts').waitFor()
    assert.equal(await section.getByRole('alert').count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
    process.stdout.write(`Patient receipt archive passed at ${width}px\n`)
  }
} finally {
  await browser.close()
}
