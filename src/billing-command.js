// Financial commands retain one immutable intent until an exact receipt AND readback confirm it.
// No financial draft, payment or receipt is written to browser storage.
export function moneyMinor(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(amount) ? amount : null
}
const sameMoney = (a, b) => moneyMinor(a) !== null && moneyMinor(a) === moneyMinor(b)
const linesKey = row => JSON.stringify((row.lines || []).map(l => [l.id, l.service?.id, l.service?.code, l.service?.name, l.service_price_id, l.quantity, l.unit_price, l.line_total]))
export function billingReceiptMatches(intent, row) {
  if (!row?.id || !Number.isInteger(row.revision)) return false
  const base = intent.base
  if (intent.mode === 'draft') return row.treatment_id === base.id && row.patient?.id === base.patient?.id && row.branch?.id === base.branch?.id && row.status === 'Draft'
  if (row.id !== base.id || row.treatment_id !== base.treatment_id || row.visit_id !== base.visit_id || row.patient?.id !== base.patient?.id || row.branch?.id !== base.branch?.id || row.invoice_number !== base.invoice_number || row.revision !== base.revision + 1 || linesKey(row) !== linesKey(base) || !sameMoney(row.gross_amount, base.gross_amount)) return false
  if (intent.mode === 'review') return row.status === 'Review'
  if (intent.mode === 'discount') return row.status === base.status && (row.discount_type || null) === intent.payload.discount_type && (row.discount_id_number || null) === (intent.payload.discount_id_number || null)
  if (intent.mode === 'issue') return ['Issued', 'Paid'].includes(row.status) && !!row.issued_at && (row.status !== 'Paid' || moneyMinor(row.balance) === 0 && (moneyMinor(row.patient_responsibility_amount) === 0 ? !row.payment && !row.receipt : confirmedBillingReceipt(row)))
  if (intent.mode !== 'payment') return false
  const p = row.payment, r = row.receipt
  return row.status === 'Paid' && !!row.paid_at && moneyMinor(row.balance) === 0 && sameMoney(row.paid_amount, row.patient_responsibility_amount) && sameMoney(row.patient_responsibility_amount, base.patient_responsibility_amount) && !!p?.id && !!r?.id && !!r.number && !!r.issued_at && !!p.recorded_at && sameMoney(p.amount, intent.payload.amount) && sameMoney(r.amount, intent.payload.amount) && p.method === intent.payload.method && r.method === intent.payload.method && (p.external_reference || null) === (intent.payload.external_reference || null) && (r.external_reference || null) === (intent.payload.external_reference || null)
}
export function confirmedBillingReceipt(row) {
  const r = row?.receipt, p = row?.payment
  return !!r?.id && !!r.number && !!r.issued_at && !!p?.id && !!p.recorded_at && row.status === 'Paid' && !!row.paid_at && moneyMinor(row.balance) === 0 && sameMoney(row.paid_amount, row.patient_responsibility_amount) && moneyMinor(r.amount) > 0 && moneyMinor(r.amount) <= moneyMinor(row.paid_amount) && typeof r.method === 'string' && !!r.method.trim() && sameMoney(r.amount, p.amount) && r.method === p.method && (r.external_reference || null) === (p.external_reference || null)
}
export function createBillingCommand({ send, read, key, allowed = () => true, publish = () => {} }) {
  let pending = false, intent = null, active = true
  const owns = () => active && allowed()
  const state = () => ({ pending, intent })
  async function run(next) {
    if (!owns() || pending || intent && next) return { ok: false, ignored: true }
    if (next) intent = structuredClone({ ...next, key: key() })
    if (!intent) return { ok: false, ignored: true }
    pending = true; publish(state())
    const attempt = intent
    try {
      const result = await send(attempt)
      if (!owns()) return { ok: false, ignored: true }
      if (!result.ok) {
        // A validation refusal is definitive. Transport failures, conflicts and contradictory
        // success responses require the same journal key; never infer that no write occurred.
        if (result.status === 422 || result.kind === 'validation') intent = null
        return result
      }
      if (!billingReceiptMatches(attempt, result.data)) return { ok: false, kind: 'unconfirmed', message: 'The returned invoice did not confirm this action. Retry the same command or reload billing.' }
      const current = await read(result.data.id)
      if (!owns()) return { ok: false, ignored: true }
      if (!current.ok || !billingReceiptMatches(attempt, current.data) || current.data.id !== result.data.id || current.data.receipt?.id !== result.data.receipt?.id || current.data.payment?.id !== result.data.payment?.id) return { ok: false, kind: 'unconfirmed', message: 'The saved result could not be verified. Retry the same command or reload billing before continuing.' }
      intent = null
      return { ok: true, data: current.data }
    } catch {
      return { ok: false, kind: 'network', message: 'The outcome is unknown. Retry the same command; do not collect the payment again.' }
    } finally {
      pending = false
      if (owns()) publish(state())
    }
  }
  return { run, state, dispose() { active = false } }
}
