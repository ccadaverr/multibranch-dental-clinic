import { addDays, validDate } from './clock.js'

export const REVENUE_FIELDS = ['gross_collected_php', 'refunded_php', 'net_cash_flow_php']

export function pesoCentavos(value) {
  if (typeof value !== 'string' || !/^-?\d+\.\d{2}$/.test(value)) throw new Error('Invalid revenue amount.')
  const negative = value.startsWith('-')
  const [whole, fraction] = value.replace('-', '').split('.')
  const amount = BigInt(whole) * 100n + BigInt(fraction)
  return negative ? -amount : amount
}

export function exactPeso(value) {
  const amount = pesoCentavos(value)
  const abs = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}₱${String(abs / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(abs % 100n).padStart(2, '0')}`
}

/** Validate the existing API projection; malformed/mismatched money is unavailable, never zero. */
export function validateRevenueReport(data, weekly = false, requested = {}) {
  const rows = weekly ? data?.buckets : data?.days
  if (data?.timezone !== 'Asia/Manila' || !Array.isArray(rows) || !data.totals) throw new Error('Revenue figures are unavailable.')
  if (weekly && (rows.length !== 6 || typeof data.is_finalized !== 'boolean' || !validDate(data.week_start_date) || !validDate(data.week_end_date))) throw new Error('Weekly figures are unavailable.')
  const custom = !weekly && Boolean(requested.date_from || requested.date_to)
  if (custom && (rows[0]?.date !== requested.date_from || rows.at(-1)?.date !== requested.date_to)) throw new Error('Daily report date range mismatch.')
  if (weekly && requested.date) {
    const weekday = new Date(`${requested.date}T00:00:00Z`).getUTCDay() || 7
    if (data.week_start_date !== addDays(requested.date, 1 - weekday)) throw new Error('Weekly report date range mismatch.')
  }
  const totals = [0n, 0n, 0n]
  const counts = [0, 0]
  let previous = ''
  for (const [index, row] of rows.entries()) {
    if (!validDate(row.date) || row.date <= previous || (weekly && (row.day_of_week !== index + 1 || new Date(`${row.date}T00:00:00Z`).getUTCDay() !== index + 1))) throw new Error('Invalid revenue dates.')
    if ((weekly || custom) && previous && row.date !== addDays(previous, 1)) throw new Error('Missing revenue dates.')
    previous = row.date
    const values = REVENUE_FIELDS.map(field => pesoCentavos(row[field]))
    if (values[0] < 0n || values[1] < 0n || values[0] - values[1] !== values[2]) throw new Error('Revenue amounts do not reconcile.')
    values.forEach((value, i) => { totals[i] += value })
    for (const [i, field] of ['payments_count', 'refunds_count'].entries()) {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error('Invalid transaction count.')
      counts[i] += row[field]
    }
  }
  if (weekly && (rows[0].date !== data.week_start_date || rows[5].date !== data.week_end_date)) throw new Error('Invalid weekly date range.')
  REVENUE_FIELDS.forEach((field, i) => { if (pesoCentavos(data.totals[field]) !== totals[i]) throw new Error('Revenue totals do not reconcile.') })
  if (data.totals.payments_count !== counts[0] || data.totals.refunds_count !== counts[1]) throw new Error('Revenue counts do not reconcile.')
  return data
}

export function weeklyChartAvailable(data, today, preview = false) {
  return data.is_finalized || data.week_end_date <= today || preview
}

export function last30DayWindows(today) {
  if (!validDate(today)) throw new Error('Invalid reporting date.')
  return { current: { date_from: addDays(today, -29), date_to: today },
    previous: { date_from: addDays(today, -59), date_to: addDays(today, -30) } }
}

/** Exact one-decimal percentage; a zero/invalid denominator is not growth. */
export function performanceChange(current, previous) {
  if (typeof current !== 'bigint' || typeof previous !== 'bigint' || current < 0n || previous <= 0n) return { direction: 'none', text: 'No comparable baseline' }
  const delta = current - previous
  if (delta === 0n) return { direction: 'flat', text: '0.0%' }
  const magnitude = delta < 0n ? -delta : delta
  const tenths = (magnitude * 1000n + previous / 2n) / previous
  return { direction: delta > 0n ? 'up' : 'down', text: tenths === 0n ? '<0.1%' : `${tenths / 10n}.${tenths % 10n}%` }
}

export function validateRevenueScope(data, branchId) {
  if (branchId && (!data?.branch || (/^[0-9a-z]{26}$/i.test(branchId) && data.branch.public_id?.toLowerCase() !== branchId.toLowerCase()))) throw new Error('Branch response mismatch.')
  if (!branchId && data?.branch) throw new Error('Branch response mismatch.')
  return data
}

export function revenueGeometry(rows, weekly = false) {
  let minimum = 0n, maximum = 0n
  for (const row of rows) {
    const gross = pesoCentavos(row.gross_collected_php), net = weekly ? pesoCentavos(row.net_cash_flow_php) : 0n
    if (gross > maximum) maximum = gross
    if (net > maximum) maximum = net
    if (net < minimum) minimum = net
  }
  if (minimum === maximum) maximum = 100n // display scale only; zero transaction amounts stay zero
  const y = cents => 32 + Number(maximum - cents) / Number(maximum - minimum) * 158
  const zeroY = y(0n)
  const ticks = [...new Set([minimum, 0n, maximum / 2n, maximum])].sort((a,b) => a < b ? -1 : a > b ? 1 : 0)
  return { zeroY, minimum, maximum, ticks: ticks.map(cents => ({ cents, y: y(cents) })),
    points: rows.map((row, i) => ({ row, x: weekly ? 108 + i * 90 : rows.length === 1 ? 320 : 68 + i * 504 / (rows.length - 1),
      y: y(pesoCentavos(row.gross_collected_php)), netY: y(pesoCentavos(row.net_cash_flow_php)) })) }
}
