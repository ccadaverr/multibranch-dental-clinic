import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'

// M11 client behaviour: the server is the only financial authority; a browser redirect is never proof of payment.

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers || {} }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })

const page = readFileSync(new URL('../src/pages/PatientCare.jsx', import.meta.url), 'utf8')
const staffPage = readFileSync(new URL('../src/pages/ServerBilling.jsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/api-client.js', import.meta.url), 'utf8')
const review = readFileSync(new URL('../src/pages/ReviewAndPay.jsx', import.meta.url), 'utf8')

test('starting a checkout sends only the invoice id: the client chooses no URL, amount or state', async () => {
  stubFetch(json(200, {}), json(200, { data: { checkout_url: 'https://checkout.example/x' } }))
  await api.createPayMongoCheckout('01j0000000000000000000i001')
  const post = calls.find(c => c.method === 'POST')
  assert.ok(post.url.endsWith('/api/invoices/01j0000000000000000000i001/paymongo-checkout'))
  assert.deepEqual(post.body, {})
  assert.doesNotMatch(page + review, /success_url|cancel_url/)
})

test('a refused or failed checkout is surfaced explicitly (never a simulated redirect)', async () => {
  for (const [status, code] of [[502, 'payment_gateway_error'], [503, 'payment_not_configured'], [422, 'hmo_financial_hold'], [403, null]]) {
    api.__resetCsrfCacheForTests()
    stubFetch(json(200, {}), json(status, { message: 'No payment was started.', code }))
    const result = await api.createPayMongoCheckout('x')
    assert.equal(result.ok, false)
    assert.ok(result.message.length > 0)
  }
  // Review and Pay redirects only to the checkout_url the server returned; any refusal is shown with the server's message.
  assert.match(review, /if \(result\.ok && result\.data\?\.checkout_url\) \{ window\.location\.href = result\.data\.checkout_url; return \}/)
  assert.match(review, /setError\(result\.message \|\| 'The payment could not be started\. No payment was made\.'\)/)
  assert.match(review, /title="Payment not started"/)
})

test('returning from the payment page never claims payment: the banner follows the server invoice status', () => {
  assert.doesNotMatch(page, /Payment Successful|Your payment has been received and your invoice is settled/)
  assert.match(page, /Confirming your payment/)
  assert.match(page, /Payment received/)
  assert.match(page, /Payment pending/)
  assert.match(page, /Payment cancelled/)
  // "paid" is only ever derived from the server's own record of the linked invoice, never from ?payment=success.
  assert.match(page, /if\(row\.status==='Paid'\)\{setLinkState\(linkPayment\?'paid':null\);return\}/)
  assert.equal((page.match(/setLinkState\([^)]*'paid'/g) || []).length, 1, 'only one place can mark it paid')
  assert.equal((page.match(/linkState==='paid'&&/g) || []).length, 1)
  assert.doesNotMatch(page, /status:\s*'Paid'/, 'the page never writes a Paid status')
  assert.match(page, /useVisibleRefresh\(checkLinked,\{active:linkState==='checking'&&linkPayment==='success',intervalMs:3000\}\)/, 'pending settlement is polled briefly')
  assert.match(page, /\+\+confirmTries\.current>=20\)setLinkState\('timeout'\)/, 'polling is bounded')
})

test('a failed invoice load is an explicit error with Retry on the Patient page and never local demo billing', () => {
  assert.match(page, /Invoices unavailable/)
  assert.match(page, /setAttempt\(attempt\+1\)/)
  assert.doesNotMatch(client.replace(/\/\/.*$/gm, '') + page, /localStorage|sessionStorage/)
  assert.match(staffPage, /Loading authoritative billing records/)
  assert.match(staffPage, /No current financial action is available until the server billing records load/)
})

test('billing commands go through named server endpoints with idempotency keys and no browser writes', () => {
  for (const name of ['createBillingDraft', 'reviewBillingInvoice', 'issueBillingInvoice', 'recordBillingPayment']) assert.match(client, new RegExp(`export function ${name}\\(`))
  assert.match(client, /These calls never write invoices, payments or receipts to browser storage/)
  assert.match(staffPage, /key: commandKey/, 'each Staff billing intent carries an Idempotency-Key retained for retry')
})

test('invoice lists are cursor-paged: bounded requests, honest "showing N" text, load-older with recoverable errors', async () => {
  stubFetch(json(200, {}), json(200, { data: [], meta: { per_page: 25, next_cursor: 'c1' } }))
  await api.myBillingInvoices({ per_page: 25, cursor: 'abc' })
  assert.match(calls.at(-1).url, /\/api\/invoices\/mine\?.*per_page=25/)
  assert.match(calls.at(-1).url, /cursor=abc/)
  api.__resetCsrfCacheForTests()
  stubFetch(json(200, {}), json(200, { data: [] }))
  await api.listBillingInvoices({ per_page: 50 })
  assert.match(calls.at(-1).url, /\/api\/invoices\?.*per_page=50/)
  for (const source of [page, staffPage]) {
    assert.match(source, /Load older invoices/)
    assert.match(source, /Older invoices unavailable/)
    assert.match(source, /Older invoices are available/)
    assert.match(source, /That is all/)
    assert.match(source, /next_cursor/)
    assert.match(source, /filter\(row\s*=>\s*!\(previous\s*\|\|\s*\[\]\)\.some/, 'older pages are merged without duplicates')
  }
  assert.match(page, /per_page:PAGE/)
  assert.doesNotMatch(client.replace(/\/\/.*$/gm, ''), /\/api\/invoices[^'`]*limit=/)
})

test('the payment confirmation asks for the one returned invoice, independent of paging', () => {
  assert.match(page, /getBillingInvoice\(linkId\)/)
  assert.match(client, /export function getBillingInvoice/)
  assert.doesNotMatch(page.slice(page.indexOf('const checkLinked'), page.indexOf('useVisibleRefresh(checkLinked')), /myBillingInvoices\(/)
})

test('receipt list requests are cursor-paged and the Pay action is disabled while a checkout is being created', async () => {
  stubFetch(json(200, {}), json(200, { data: [], meta: { per_page: 25, next_cursor: null } }))
  await api.myBillingReceipts({ per_page: 25, cursor: 'zzz' })
  assert.match(calls.at(-1).url, /\/api\/receipts\/mine\?.*per_page=25/)
  assert.match(calls.at(-1).url, /cursor=zzz/)
  assert.match(review, /disabled=\{busy\}/)
  assert.match(review, /if \(busy\) return/)
})
