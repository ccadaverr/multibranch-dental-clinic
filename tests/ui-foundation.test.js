import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('GEN-03: .top-icon-btn has no border and accessible :focus-visible ring in styles.css and foundation.css', () => {
  const stylesCss = read('src/styles.css')
  const foundationCss = read('src/foundation.css')

  // styles.css: .top-icon-btn is decoupled from .icon-btn and has no border
  assert.doesNotMatch(stylesCss, /\.top-icon-btn,\.icon-btn\s*\{[^}]*border:\s*1px solid/, 'styles.css does not group top-icon-btn with bordered icon-btn')
  assert.match(stylesCss, /\.top-icon-btn\s*\{[^}]*border:\s*none;[^}]*background:\s*transparent/, 'styles.css defines .top-icon-btn with border:none and background:transparent')
  assert.match(stylesCss, /\.top-icon-btn:focus-visible\s*\{[^}]*outline:\s*2px solid/, 'styles.css provides an accessible :focus-visible ring for top-icon-btn')

  // foundation.css: confirms border: none !important and focus-visible outline
  assert.match(foundationCss, /\.top-icon-btn[^{]*\{[^}]*border:\s*none\s*!important/s, 'foundation.css ensures border: none !important on top-icon-btn')
  assert.match(foundationCss, /\.top-icon-btn:focus-visible[^{]*\{[^}]*outline:\s*2px solid/s, 'foundation.css provides focus-visible ring')
})

test('GEN-06: select controls maintain accessible height and table-wrap retains horizontal scroll', () => {
  const foundationCss = read('src/foundation.css')

  // Native selects have min-height for touch targets
  assert.match(foundationCss, /select[^{]*\{[^}]*font-family:\s*inherit/s, 'selects inherit font')
  assert.match(foundationCss, /\.filter-bar-controls select[^{]*\{[^}]*min-height:\s*var\(--control-height\)/s, 'filter bar selects have accessible control height')

  // Table wrappers retain scrollability without broken overflow
  assert.match(foundationCss, /\.table-wrap\s*\{[^}]*overflow:\s*auto/, '.table-wrap keeps overflow: auto')

  // Custom popovers (e.g. auth country menu) maintain absolute positioning and high z-index
  assert.match(foundationCss, /\.auth-country-menu\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*30;/, '.auth-country-menu maintains high z-index and absolute positioning')
})

test('STF-02 & STF-09: FilterBar uses shared SearchInput with icon and aligns search and filter controls horizontally', () => {
  const components = read('src/components.jsx')
  const foundationCss = read('src/foundation.css')

  assert.match(components, /<SearchInput className="filter-bar-search"/, 'FilterBar renders SearchInput for consistent search icon and clear affordance')
  assert.match(foundationCss, /\.filter-bar-controls\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap;\s*align-items:\s*flex-end;/)
  assert.match(foundationCss, /\.filter-bar-controls select,\s*\.filter-bar-controls input\s*\{[^}]*width:\s*auto;\s*flex:\s*1\s+1\s+150px;/s)
})

test('STF-10 & STF-12: CheckInPage has a single header RefreshButton and a single searchable walk-in patient combobox', () => {
  const patientFlow = read('src/pages/PatientFlow.jsx')

  // STF-10: Scheduled arrivals Card no longer duplicates the RefreshButton in its card actions
  assert.match(patientFlow, /<Card className="checkin-focus-card" title="Scheduled arrivals" subtitle="Select the patient who has arrived \(earliest first\)\.">/)
  assert.doesNotMatch(patientFlow, /title="Scheduled arrivals"[^>]*actions=\{<RefreshButton/)

  // STF-12: Walk-in admission uses a single searchable combobox instead of two separate fields
  assert.match(patientFlow, /role="combobox"/)
  assert.match(patientFlow, /aria-controls="walkin-patient-listbox"/)
  assert.match(patientFlow, /role="listbox" className="patient-combobox-list"/)
  assert.doesNotMatch(patientFlow, /<Field label="Find patient"/)
})

test('STF-16 & STF-17: Queue row patient is clickable to open chart and queue actions include call and message icon buttons', () => {
  const patientFlow = read('src/pages/PatientFlow.jsx')
  const foundationCss = read('src/foundation.css')

  // STF-16: Clicking patient name in queue opens chart; redundant "Open Chart" button is removed
  assert.match(patientFlow, /className="queue-patient-link"/)
  assert.match(patientFlow, /title="Click to open patient chart"/)
  assert.match(patientFlow, /onClick=\{\(\)=>setPage\('patients',encounterContext\(q\)\)\}/)
  assert.doesNotMatch(patientFlow, /<Button[^>]*>Open Chart<\/Button>/)

  // STF-16 CSS: styles for .queue-patient-link
  assert.match(foundationCss, /\.queue-patient-link\s*\{[^}]*cursor:\s*pointer;/s)
  assert.match(foundationCss, /\.queue-patient-link:hover\s+b\s*\{[^}]*text-decoration:\s*underline;/s)

  // STF-17: Call and message icon buttons with tooltips and aria-labels
  assert.match(patientFlow, /className="icon-btn queue-call-btn"/)
  assert.match(patientFlow, /title="Call patient in queue"/)
  assert.match(patientFlow, /<Icon name="phone"/)
  assert.match(patientFlow, /className="icon-btn queue-message-btn"/)
  assert.match(patientFlow, /title="Open patient conversation"/)
  assert.match(patientFlow, /<Icon name="message"/)
})

test('STF-25 & DEN-16: ArchivesPage View action has soft variant, file icon, and label, and dentist archives enforce RBAC', () => {
  const archivesPage = read('src/pages/ArchivesPage.jsx')

  // STF-25: View button in visits, prescriptions, and financials has variant="soft", icon="file", and "View details"
  assert.match(archivesPage, /<Button size="sm" variant="soft" icon="file" title="View details" aria-label=\{`View details for \${r\.code \|\| r\.id}`\} onClick=\{[\s\S]*?setViewRecord\(\{ kind: 'visit', record: r \}\)[\s\S]*?\}\>View details<\/Button>/)
  assert.match(archivesPage, /<Button size="sm" variant="soft" icon="file" title="View details" aria-label=\{`View details for \${r\.number \|\| r\.id}`\} onClick=\{[\s\S]*?setViewRecord\(\{ kind: 'prescription', record: r \}\)[\s\S]*?\}\>View details<\/Button>/)
  assert.match(archivesPage, /<Button size="sm" variant="soft" icon="file" title="View details" aria-label=\{`View details for \${r\.invoiceNumber \|\| r\.id}`\} onClick=\{[\s\S]*?setViewRecord\(\{ kind: 'financial', record: r \}\)[\s\S]*?\}\>View details<\/Button>/)

  // DEN-16: Dentist role filters archive records to dentist-scoped items
  assert.match(archivesPage, /const isDentistRecord = \(item\.dentistId && item\.dentistId === session\?\.dentistId\)/)
  assert.match(archivesPage, /if \(!inDentistBranch \|\| !isDentistRecord\) return false/)
})

test('DEN-01, DEN-02 & DEN-12: Dentist Clinical Home text size, My Schedule date toolbar & slot layout, and My Work Hours UI', () => {
  const foundationCss = read('src/foundation.css')
  const schedulingJsx = read('src/pages/DentistSchedule.jsx')
  const staffingJsx = read('src/pages/Staffing.jsx')

  // DEN-01: Increased text sizes on Clinical Home for legibility
  assert.match(foundationCss, /\.dentist-command-grid \.next-patient-top h2\s*\{\s*font-size:\s*22px;/)
  assert.match(foundationCss, /\.dentist-command-grid \.clinical-stat-stack b\s*\{\s*font-size:\s*24px;/)
  assert.match(foundationCss, /\.dentist-command-grid \.clinical-stat-stack small\s*\{\s*font-size:\s*13px;/)
  assert.match(foundationCss, /\.dentist-command-grid \.day-list-row b\s*\{\s*font-size:\s*14px;/)
  assert.match(foundationCss, /\.dentist-command-grid \.day-time\s*\{\s*font-size:\s*13px;/)
  assert.match(foundationCss, /\.dentist-command-grid \.task-list b\s*\{\s*font-size:\s*14px;/)

  // DEN-02: A7 keeps one-click day navigation in the dedicated Manila-date toolbar.
  assert.match(schedulingJsx, /aria-label="Previous day" onClick=\{\(\) => setDate\(d => addDays\(d, -1\)\)\}>Previous<\/Button>/)
  assert.match(schedulingJsx, /<Button variant="soft" onClick=\{\(\) => setDate\(today\)\}>Today<\/Button>/)
  assert.match(schedulingJsx, /aria-label="Next day" onClick=\{\(\) => setDate\(d => addDays\(d, 1\)\)\}>Next<\/Button>/)
  assert.match(read('src/pages/DentistWorkspace.jsx'), /a\.end && <small>\{displayTime\(a\.end\)\}/)
  assert.match(foundationCss, /\.day-schedule \.schedule-slot\s*\{[^}]*grid-template-columns:\s*140px 24px minmax\(0, 1fr\);/s)
  assert.match(foundationCss, /\.day-schedule \.schedule-time\s*\{[^}]*text-align:\s*right;/s)
  assert.match(read('src/dentist-schedule.css'), /\.dentist-schedule \.day-schedule \.schedule-slot\s*\{\s*grid-template-columns:\s*180px 24px minmax\(0, 1fr\);/)

  // DEN-12: My Work Hours auto-selection and improved week row layout
  assert.match(staffingJsx, /title=\{role === 'dentist' \? 'My work hours' : 'Work schedules'\}/)
  assert.match(staffingJsx, /const ownDentist = role === 'dentist' \? \(r\.data\.dentists\.find\(d => d\.id === store\?\.session\?\.dentistId \|\| d\.userId === store\?\.session\?\.userId\)\) : null/)
  assert.match(staffingJsx, /role === 'dentist' \? \(<div className="dentist-hours-header"/)
  assert.match(foundationCss, /\.st-week > li\s*\{[^}]*grid-template-columns:\s*110px 1fr;/s)
  assert.match(foundationCss, /\.st-week \.st-day\s*\{[^}]*font-size:\s*14px;/s)
})

test('DEN-15: TemplateEditor renders structured read-only display, preview header, and standard button sizes', () => {
  const automationsJsx = read('src/pages/Automations.jsx')
  const automationsCss = read('src/automations.css')

  // Dentist read-only display when canEdit is false
  assert.match(automationsJsx, /className="au-readonly-wording"/)
  assert.match(automationsJsx, /className="au-readonly-field"/)
  assert.match(automationsJsx, /className="au-readonly-body"/)
  assert.match(automationsJsx, /className="au-approval-status-bar"/)

  // Standard action buttons with size="sm" and approval badges
  assert.match(automationsJsx, /<Button size="sm" variant="soft" disabled=\{!!busy\} onClick=\{show\}/)
  assert.match(automationsJsx, /<Button size="sm" variant="primary" icon="check"/)
  assert.match(automationsJsx, /className="au-tag is-ok au-approved-badge"/)

  // Preview header & empty state
  assert.match(automationsJsx, /className="au-preview-header"/)
  assert.match(automationsJsx, /className="au-preview-title"/)
  assert.match(automationsJsx, /className="au-preview-empty"/)

  // CSS definitions
  assert.match(automationsCss, /\.au-readonly-wording\s*\{/)
  assert.match(automationsCss, /\.au-readonly-field\s*\{/)
  assert.match(automationsCss, /\.au-readonly-body\s*\{/)
  assert.match(automationsCss, /\.au-preview-header\s*\{/)
  assert.match(automationsCss, /\.au-preview-title\s*\{/)
  assert.match(automationsCss, /\.au-preview-empty\s*\{/)
})

test('OWN-02 through OWN-06: Owner Branch Management UI upgrades', () => {
  const adminJsx = read('src/pages/Admin.jsx')
  const foundationCss = read('src/foundation.css')
  const branchMapJs = read('src/branch-map.js')

  // OWN-02: Branch code dropdown with allowed codes and duplicate blocking
  assert.match(adminJsx, /export const ALLOWED_BRANCH_CODES =/)
  assert.match(adminJsx, /<Field label="Branch code"/)
  assert.match(adminJsx, /<select\s+value=\{form\.branchCode/)
  assert.match(adminJsx, /codesInUse\.has\(code\)/)
  assert.match(adminJsx, /if \(codesInUse\.has\(form\.branchCode\)\)/)

  // OWN-03: Pinnable map picker with read-only coordinates readout
  assert.match(adminJsx, /export function BranchMapPicker/)
  assert.match(adminJsx, /<BranchMapPicker/)
  assert.match(adminJsx, /className="branch-coords-readout"/)
  assert.doesNotMatch(adminJsx, /<Field label="Map latitude \(optional\)"/)
  assert.doesNotMatch(adminJsx, /<Field label="Map longitude \(optional\)"/)
  assert.match(branchMapJs, /export function mountBranchPinMap/)
  assert.match(branchMapJs, /draggable: true/)

  // OWN-04: Tokenized branch cards and status-aware chips
  assert.match(adminJsx, /className=\{`branch-overview-card \$\{isSel \? 'branch-card-selected' : ''\}`\}/)
  assert.match(adminJsx, /className="branch-code-badge"/)
  assert.match(adminJsx, /<Status tone=\{b\.status === 'Open' \? 'success' : b\.status === 'Temporarily Closed' \? 'warning' : 'neutral'\}>/)
  assert.match(foundationCss, /\.branch-overview-card\s*\{/)
  assert.match(foundationCss, /\.branch-overview-card\.branch-card-selected\s*\{/)
  assert.match(foundationCss, /\.branch-code-badge\s*\{/)

  // OWN-05: Closed option toggle button instead of checkbox
  assert.match(adminJsx, /className=\{`btn-toggle-closed \$\{!h \? 'is-closed' : 'is-open'\}`\}/)
  assert.match(adminJsx, /aria-pressed=\{!h\}/)
  assert.doesNotMatch(adminJsx, /<label className="hours-closed"><input type="checkbox"/)
  assert.match(foundationCss, /\.btn-toggle-closed\s*\{/)
  assert.match(foundationCss, /\.btn-toggle-closed\.is-closed\s*\{/)
  assert.match(foundationCss, /\.btn-toggle-closed\.is-open\s*\{/)

  // OWN-06: Available services 2x2 responsive grid
  assert.match(adminJsx, /className="branch-services-grid"/)
  assert.match(adminJsx, /className=\{`branch-service-item \$\{active\?'is-active':''\}`\}/)
  assert.match(foundationCss, /\.branch-services-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/)
  assert.match(foundationCss, /@media\s*\(max-width:\s*640px\)\s*\{\s*\.branch-services-grid\s*\{\s*grid-template-columns:\s*1fr;/)
})

test('STF-01, OWN-07, OWN-08, OWN-09: Appointment Calendar UI, shared component, past days, and details layout', () => {
  const staffCalJsx = read('src/pages/StaffDayCalendar.jsx')
  const schedulingJsx = read('src/pages/DentistSchedule.jsx')
  const appJsx = read('src/App.jsx')
  const foundationCss = read('src/foundation.css')

  // STF-01: Shared calendar avatars (3 max) and +N overflow
  assert.match(staffCalJsx, /const shown = list\.slice\(0, 3\)/)
  assert.match(staffCalJsx, /className="daycal-avatar-badge daycal-more-avatar"/)
  assert.match(staffCalJsx, /className="daycal-cell-chips daycal-avatars-row"/)

  // OWN-07: Owner uses the shared StaffDayCalendar component
  assert.match(appJsx, /case 'calendar': content=<StaffDayCalendar store=\{store\}\/>/)

  // OWN-08: Past days greyed out on shared calendar & dentist schedule
  assert.match(staffCalJsx, /past-day is-past/)
  assert.match(foundationCss, /\.daycal-cell\.past-day,\s*\.daycal-cell\.is-past\s*\{[^}]*opacity:\s*0\.75;/s)
  assert.match(schedulingJsx, /date < today \? 'Past appointments'/)
  assert.match(schedulingJsx, /<AppointmentAgenda rows=\{rows\}/)
  assert.match(foundationCss, /\.schedule-past-day\s*\{/)

  // OWN-09: Redesigned appointment details modal layout
  assert.match(staffCalJsx, /className="appt-detail-container"/)
  assert.match(staffCalJsx, /className="appt-detail-header-card"/)
  assert.match(staffCalJsx, /className="appt-detail-grid"/)
  assert.match(staffCalJsx, /<h4 className="appt-detail-section-title">Schedule & Location<\/h4>/)
  assert.match(staffCalJsx, /<h4 className="appt-detail-section-title">Clinical & Care<\/h4>/)
  assert.match(staffCalJsx, /className="appt-detail-footer-bar"/)
  assert.match(staffCalJsx, /className="appt-detail-actions"/)
  assert.match(foundationCss, /\.appt-detail-container\s*\{/)
  assert.match(foundationCss, /\.appt-detail-header-card\s*\{/)
  assert.match(foundationCss, /\.appt-detail-grid\s*\{/)
})
test('STF-14, STF-15, OWN-13: Live queue simplified with arrival FIFO and owner branch view parity', () => {
  const patientFlow = read('src/pages/PatientFlow.jsx')
  const logicJs = read('src/logic.js')
  const queueEntryModel = read('backend/app/Models/QueueEntry.php')

  // STF-14: Remaining queue statuses are In Queue, In Treatment, Done (Waiting/Called/Treatment Ready/Temporarily Away removed from UI filter)
  assert.match(patientFlow, /<option value="In Queue">In Queue<\/option>/)
  assert.match(patientFlow, /<option value="In Treatment">In Treatment<\/option>/)
  assert.match(patientFlow, /<option value="Done">Done<\/option>/)
  assert.doesNotMatch(patientFlow, /<option>Waiting<\/option>/)
  assert.doesNotMatch(patientFlow, /<option>Temporarily Away<\/option>/)
  assert.doesNotMatch(patientFlow, /Marked temporarily away/)
  assert.doesNotMatch(patientFlow, /Returned to the queue/)

  // STF-15: Urgent queue priority removed, FIFO arrival order
  assert.doesNotMatch(patientFlow, /Urgent queue priority/)
  assert.doesNotMatch(patientFlow, /q\.priority==='Urgent'/)
  assert.doesNotMatch(patientFlow, /q\.priority==='Priority'/)
  assert.doesNotMatch(logicJs, /priorityRank/)
  assert.match(patientFlow, /Arrival order determines positions inside each dentist queue \(first-come, first-served\)\./)

  // OWN-13: Owner live queue by branch has parity with staff queue
  assert.match(patientFlow, /aria-label="Filter queue details by branch"/)
  assert.match(patientFlow, /aria-label="Filter queue details by status"/)
  assert.match(patientFlow, /<option value="In Queue">In Queue<\/option>[\s\S]*?<option value="In Treatment">In Treatment<\/option>[\s\S]*?<option value="Done">Done<\/option>/)
  assert.match(patientFlow, /onClick=\{\(\) => setPage && setPage\('patients', encounterContext\(q\)\)\}/)
  assert.match(patientFlow, /className="icon-btn queue-call-btn"/)
  assert.match(patientFlow, /className="icon-btn queue-message-btn"/)

  // Backend model supports In Queue, In Treatment, Done
  assert.match(queueEntryModel, /'In Queue',\s*'In Treatment',\s*'Done'/)
})
