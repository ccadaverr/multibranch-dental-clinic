// Patient portal formatting. All clinic dates and times are Asia/Manila business values from the server; nothing here invents data.
const TZ = 'Asia/Manila'

export const money = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2026-10-15" -> "Thu, Oct 15, 2026" (a calendar date, no timezone shift). */
export function dateLong(date, { year = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return ''
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

/** "14:00" -> "2:00 PM". */
export function time12(hhmm) {
  const m = /^(\d{2}):(\d{2})/.exec(String(hhmm || ''))
  if (!m) return ''
  const h = Number(m[1]), suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`
}

export function todayManila(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now))
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '•'

const ACTIVE = ['Confirmed', 'Pending', 'Checked In', 'In Treatment']
/** Upcoming = an active appointment that starts in the future, soonest first. */
export function splitAppointments(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const upcoming = list.filter(a => ACTIVE.includes(a.status) && (new Date(a.starts_at) > now || a.date === todayManila(now) || ['Checked In', 'In Treatment'].includes(a.status))).sort((a, b) => String(a.starts_at || a.date || '').localeCompare(String(b.starts_at || b.date || '')))
  const past = list.filter(a => !upcoming.includes(a)).sort((a, b) => String(b.starts_at || b.date || '').localeCompare(String(a.starts_at || a.date || '')))
  return { upcoming, past }
}

/** An .ics calendar file for one appointment (generated in the browser; nothing is sent anywhere). */
export function icsFor({ id, service, branchName, branchAddress, dentist, startsAt, endsAt, clinicName }) {
  const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = text => String(text || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\n/g, '\\n')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Patient Portal//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${id}@patient-portal`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(startsAt)}`, `DTEND:${stamp(endsAt)}`,
    `SUMMARY:${esc(`${service} · ${clinicName}`)}`, `LOCATION:${esc([branchName, branchAddress].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc(dentist ? `With ${dentist}. Please arrive a few minutes early.` : 'Please arrive a few minutes early.')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(service)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
}

export function downloadIcs(appointment, name = 'appointment.ics') {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(new Blob([icsFor(appointment)], { type: 'text/calendar;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Branch opening hours (weekly_hours from the API: {"1": {open, close} | null, …, "7": …}; ISO weekdays, null = closed).
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LONG_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dayHours = (weekly, iso) => { const h = weekly?.[String(iso)] ?? weekly?.[iso]; return h && h.open && h.close ? { open: String(h.open).slice(0, 5), close: String(h.close).slice(0, 5) } : null }

/** "Mon–Fri 8:00 AM – 8:00 PM · Sat 8:00 AM – 5:00 PM · Sun closed" (days with the same hours grouped). Empty when unknown. */
export function hoursSummary(weekly, { long = false } = {}) {
  if (!weekly || typeof weekly !== 'object') return ''
  const names = long ? LONG_DAYS : SHORT_DAYS
  const groups = []
  for (let d = 1; d <= 7; d++) {
    const h = dayHours(weekly, d)
    const label = h ? `${time12(h.open)} – ${time12(h.close)}` : 'closed'
    const last = groups[groups.length - 1]
    if (last && last.label === label && last.to === d - 1) last.to = d
    else groups.push({ from: d, to: d, label })
  }
  return groups.map(g => `${g.from === g.to ? names[g.from - 1] : `${names[g.from - 1]}–${names[g.to - 1]}`} ${g.label}`).join(' · ')
}

/** Day of week (ISO) and "HH:MM" now in Asia/Manila. */
export function manilaNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  return { iso: SHORT_DAYS.indexOf(parts.weekday) + 1, time: `${parts.hour}:${parts.minute}` }
}

/** {open, label, today}: "Open now · until 8:00 PM", or "Closed · opens Mon 8:00 AM", computed in Asia/Manila. */
export function openStatus(weekly, now = new Date()) {
  if (!weekly || typeof weekly !== 'object') return { open: false, label: '', today: null }
  const { iso, time } = manilaNow(now)
  const today = dayHours(weekly, iso)
  if (today && time >= today.open && time < today.close) return { open: true, label: `Open now · until ${time12(today.close)}`, today }
  if (today && time < today.open) return { open: false, label: `Closed · opens today ${time12(today.open)}`, today }
  for (let i = 1; i <= 7; i++) {
    const d = ((iso - 1 + i) % 7) + 1, h = dayHours(weekly, d)
    if (h) return { open: false, label: `Closed · opens ${i === 1 ? 'tomorrow' : SHORT_DAYS[d - 1]} ${time12(h.open)}`, today }
  }
  return { open: false, label: 'Closed', today }
}
