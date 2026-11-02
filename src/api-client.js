// Backend Foundation 1B — thin HTTP client for the real Laravel/Sanctum backend. Every exported function
// returns one normalized result shape, so nothing above this module ever needs to know about Laravel, Sanctum,
// CSRF or raw HTTP status codes:
//   {ok:true, data}
//   {ok:false, kind:'validation', errors:{field:[msg]}, message}
//   {ok:false, kind:'invalid_credentials'|'inactive_account'|'email_verification_required', message}
//   {ok:false, kind:'unauthenticated'|'forbidden'}
//   {ok:false, kind:'network'|'server', message}
// Session auth only (Sanctum SPA cookies) — never a bearer token in localStorage.

import { deviceId } from './intake/device-id.js'
export const apiBase = () => apiBaseUrl()
function apiBaseUrl() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.VITE_API_BASE_URL !== 'undefined') {
      return import.meta.env.VITE_API_BASE_URL
    }
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return ''
    }
    return 'http://localhost:8000'
  } catch {
    return 'http://localhost:8000'
  }
}

function getCookie(name) {
  if (typeof document === 'undefined') return ''
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

// Sanctum's documented SPA flow: fetch the CSRF cookie once, cache the in-flight/settled promise so concurrent
// mutating calls don't each trigger their own fetch. Cleared on a 419 (stale/expired token) and after logout.
let csrfFetchPromise = null
function resetCsrfCache() { csrfFetchPromise = null }
function ensureCsrfCookie() {
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetch(`${apiBaseUrl()}/sanctum/csrf-cookie`, { credentials: 'include', headers: { Accept: 'application/json' } })
      .catch(error => { csrfFetchPromise = null; throw error })
  }
  return csrfFetchPromise
}

async function rawFetch(path, options) {
  const method = (options.method || 'GET').toUpperCase()
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers = { Accept: 'application/json', ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  if (method !== 'GET') {
    await ensureCsrfCookie()
    const token = getCookie('XSRF-TOKEN')
    if (token) headers['X-XSRF-TOKEN'] = token
  }
  return fetch(`${apiBaseUrl()}${path}`, { ...options, method, headers, credentials: 'include' })
}


async function parseFailure(response) {
  let body = null
  try { body = await response.json() } catch { /* no JSON body */ }
  if (response.status === 403 && body?.code === 'session_revoked') return { ok: false, kind: 'unauthenticated' }
  if (response.status === 401) return { ok: false, kind: 'unauthenticated' }
  if (response.status === 403) return { ok: false, kind: 'forbidden', message: body?.message || 'This is outside your access.' }
  if (response.status === 404) return { ok: false, kind: 'not_found', message: 'That record could not be found.' }
  // Stale revision or a lost concurrent race (M6): the machine-readable code tells the UI which one.
  if (response.status === 409) return { ok: false, kind: 'conflict', code: body?.code || null, message: body?.message || 'This changed on the server. Refresh and try again.' }
  if (response.status === 419) return { ok: false, kind: 'csrf' }
  if (response.status === 422) {
    const code = body?.code
    if (code === 'invalid_credentials' || code === 'inactive_account' || code === 'email_verification_required') {
      return { ok: false, kind: code, message: body?.message || 'Sign-in failed.' }
    }
    // M6 command refusals add a stable `code`, the failed scheduling checks and alternative start times.
    return { ok: false, kind: 'validation', code: code || null, errors: body?.errors || {}, message: body?.message || 'Check the highlighted fields.',
      failedChecks: Array.isArray(body?.failed_checks) ? body.failed_checks : [], alternatives: Array.isArray(body?.alternatives) ? body.alternatives : [] }
  }
  if (response.status === 429) return { ok: false, kind: 'rate_limited', code: body?.code || null, retry_after: body?.retry_after || 0, message: body?.message || 'Please wait and try again.' }
  if (response.status === 503) return { ok: false, kind: 'server', code: body?.code || null, message: body?.message || 'The clinic system could not send the email. Try again.' }
  // M11: an online-payment gateway refusal carries a deliberate, safe message ("No payment was started.") — show it instead of the generic outage text.
  if (response.status === 502 && typeof body?.code === 'string' && body.code.startsWith('payment_') && body.message) return { ok: false, kind: 'server', code: body.code, message: body.message }
  // M7: the assistant's own refusals carry a deliberate, safe message (no provider text) — show it instead of the generic outage text.
  if (response.status === 502 && typeof body?.code === 'string' && body.code.startsWith('assistant_') && body.message) return { ok: false, kind: 'server', code: body.code, message: body.message }
  if (response.status >= 500) return { ok: false, kind: 'server', message: 'The clinic system is temporarily unavailable. Try again in a moment.' }
  return { ok: false, kind: 'server', message: 'Something unexpected happened. Try again.' }
}

// One CSRF retry, never a loop: a 419 clears the cached cookie state, fetches a fresh one, and retries the
// exact same request exactly once. Any further failure (including a second 419) is returned as-is.
async function request(path, options = {}, { allowCsrfRetry = true } = {}) {
  let response
  try {
    response = await rawFetch(path, options)
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the clinic system. Check your connection and try again.' }
  }
  if (response.ok) {
    if (response.status === 204) return { ok: true, data: null }
    const body = await response.json().catch(() => null)
    // Paginated lists keep their meta/links so a client can page through a bounded range.
    // M18: a command that sent email reports its dispatch outcome next to `data`.
    return { ok: true, data: body?.data ?? body, ...(body?.meta ? { meta: body.meta } : {}), ...(body?.links ? { links: body.links } : {}), ...(body?.delivery ? { delivery: body.delivery } : {}) }
  }
  const failure = await parseFailure(response)
  if (failure.kind === 'csrf') {
    resetCsrfCache()
    if (allowCsrfRetry) return request(path, options, { allowCsrfRetry: false })
    return { ok: false, kind: 'network', message: 'Your session could not be verified. Please try again.' }
  }
  if (failure.kind === 'unauthenticated' && /^\/api\/(users(?:\/|$)|prescriptions(?:\/|\?|$)|followups(?:\/|\?|$)|patients\/[^/]+\/(?:chart|followups)(?:\?|$)|login$|logout$)/.test(path)) reportSessionInvalidated()
  return failure
}

export function me({signal}={}) {
  return request('/api/me',signal?{signal}:{})
}

export function login(email, password) {
  return request('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function register(payload) {
  return request('/api/register', { method: 'POST', body: JSON.stringify(payload) })
}

export function verifyRegistrationEmail(email, otp) {
  return request('/api/register/verify', { method: 'POST', body: JSON.stringify({ email, otp }) })
}

export function resendRegistrationEmail(email) {
  return request('/api/register/resend', { method: 'POST', body: JSON.stringify({ email }) })
}

// M1 password reset by emailed code (same answer whether or not the email has an account) and sign-in email change.
export function requestPasswordReset(identifier) {
  const body = typeof identifier === 'object' && identifier !== null
    ? identifier
    : (typeof identifier === 'string' && identifier.includes('@') ? { email: identifier } : { identifier })
  return request('/api/password/forgot', { method: 'POST', body: JSON.stringify(body) })
}

export function verifyPasswordResetOtp({ ticket, otp }) {
  return request('/api/password/verify-otp', { method: 'POST', body: JSON.stringify({ ticket, otp }) })
}

export function resetPassword({ email, otp, resetToken, password, passwordConfirmation }) {
  const body = resetToken
    ? { reset_token: resetToken, password, password_confirmation: passwordConfirmation }
    : { email, otp, password, password_confirmation: passwordConfirmation }
  return request('/api/password/reset', { method: 'POST', body: JSON.stringify(body) })
}

export function requestEmailChange({ newEmail, currentPassword }) {
  return request('/api/account/email', { method: 'POST', body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }) })
}

export function confirmEmailChange(otp) {
  return request('/api/account/email/confirm', { method: 'POST', body: JSON.stringify({ otp }) })
}

// Logout is honest about what actually happened: `backendConfirmed` is true only when the server itself
// confirmed the session was invalidated. A network/server failure still resets the cached CSRF state (the next
// login should never reuse a token from a session that may no longer exist) but must not be reported as a
// confirmed sign-out — the caller decides how to tell the user the difference.
export async function logout() {
  const result = await request('/api/logout', { method: 'POST' })
  resetCsrfCache()
  if (result.ok) return { ok: true, backendConfirmed: true }
  return { ok: false, backendConfirmed: false, kind: result.kind, message: result.message }
}

// Shared session-invalidated signal. A 401 from an authenticated call means the server session may be gone; the app
// shell (App.jsx) subscribes once and revalidates/clears the frontend session through its normal auth path. This is a
// notification only: nothing is retried here, and the failed call still returns its 401 result to its caller.
const sessionInvalidatedListeners = new Set()
export function onSessionInvalidated(listener) {
  sessionInvalidatedListeners.add(listener)
  return () => { sessionInvalidatedListeners.delete(listener) }
}
export function reportSessionInvalidated() {
  resetCsrfCache()
  for (const listener of [...sessionInvalidatedListeners]) listener()
}
// Revalidation after a reported 401: true only when /api/me confirms the same account (user public id) is still signed in.
export async function sessionStillValid(serverUserId) {
  const result = await me()
  return !!(result.ok && serverUserId && result.data?.id === serverUserId)
}

// Test-only: reset the module-level CSRF cache between test cases (Node's ESM module cache would otherwise
// leak it across test files/cases that share this module instance).
export function __resetCsrfCacheForTests() { resetCsrfCache() }

// Phase 2A reference data (see the Phase 2A plan). Read functions: any authenticated role except
// listStaff (Patient is denied server-side — the frontend bootstrap bridge simply never calls this for a
// Patient session, see reference-data-bridge.js). Mutation functions always send legacy_ref-keyed
// identifiers (route segments and branch_ref/service_ref body fields) — never an internal bigint id.
export function listBranches() { return request('/api/branches') }
export function listServices() { return request('/api/services') }
export function listBranchServices() { return request('/api/branch-services') }
export function listStaff() { return request('/api/staff') }
export function listDentists() { return request('/api/dentists') }

export function updateBranch(legacyRef, payload) {
  return request(`/api/branches/${encodeURIComponent(legacyRef)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function setBranchService(payload) {
  return request('/api/branch-services', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateStaffProfile(legacyRef, payload) {
  return request(`/api/staff/${encodeURIComponent(legacyRef)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function updateDentistProfile(legacyRef, payload) {
  return request(`/api/dentists/${encodeURIComponent(legacyRef)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

// M1 User Management is deliberately separate from transitional state.users. These calls are on-demand
// for the Owner screen and expose only the backend account collection.
export function listUserAccounts() { return request('/api/users') }
export function createUserAccountRemote(payload) { return request('/api/users', { method: 'POST', body: JSON.stringify(payload) }) }
export function updateUserAccountRemote(id, payload) { return request(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }) }
// M1 Staff authorization branch scopes (Owner-only on the server).
export function getBranchScopes(id) { return request(`/api/users/${encodeURIComponent(id)}/branch-scopes`) }
export function setBranchScopes(id, branchRefs) { return request(`/api/users/${encodeURIComponent(id)}/branch-scopes`, { method: 'PUT', body: JSON.stringify({ branch_refs: branchRefs }) }) }
export function deleteUserAccountRemote(id) { return request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }) }

// M6 Appointment API (server-authoritative appointments). Raw calls only; src/appointments-api.js owns paging,
// Idempotency-Key handling and mapping. `key` is the Idempotency-Key for one user confirm attempt.
const query = params => {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== null && value !== undefined && value !== '')
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}
const command = (path, payload, key) => request(path, { method: 'POST', body: JSON.stringify(payload), headers: key ? { 'Idempotency-Key': key } : {} })
export function listAppointments(params) { return request(`/api/appointments${query(params)}`) }
export function getAppointment(id) { return request(`/api/appointments/${encodeURIComponent(id)}`) }
export function appointmentAvailability(params) { return request(`/api/appointments/availability${query(params)}`) }
export function appointmentRecommendation(params) { return request(`/api/appointments/recommendation${query(params)}`) }
export function createAppointment(payload, key) { return command('/api/appointments', payload, key) }
export function rescheduleAppointment(id, payload, key) { return command(`/api/appointments/${encodeURIComponent(id)}/reschedule`, payload, key) }
export function cancelAppointmentRemote(id, payload, key) { return command(`/api/appointments/${encodeURIComponent(id)}/cancel`, payload, key) }
// Appointment-only lifecycle command: the pre-arrival 'no-show' (Check-In and treatment progression are Visit commands).
export function transitionAppointment(id, name, payload, key) { return command(`/api/appointments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, payload, key) }
// Minimal M4 Patient directory (Staff/Owner selection) and front-desk registration (Person + Patient, no login).
export function searchPatients(params) { return request(`/api/patients${query(params)}`) }
export function registerPatient(payload, key) { return command('/api/patients', payload, key) }
// M4 Patient record: non-clinical profile (read; Staff-only edit with expected_revision) and the read-only linked-record index.
export function getPatientRecord(id) { return request(`/api/patients/${encodeURIComponent(id)}`) }
export function updatePatientRecordRemote(id, payload) { return request(`/api/patients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }) }
export function getPatientRecordIndex(id) { return request(`/api/patients/${encodeURIComponent(id)}/records`) }

// M8 Patient Check-In and the shared Visit / Clinical Encounter. Raw calls only; src/visits-api.js owns mapping.
export function listVisits(params) { return request(`/api/visits${query(params)}`) }
export function getVisit(id) { return request(`/api/visits/${encodeURIComponent(id)}`) }
export function checkInVisit(payload, key) { return command('/api/visits/check-in', payload, key) }
export function walkInVisit(payload, key) { return command('/api/visits/walk-in', payload, key) }

// M5 Treatment & Clinical Workflow. Raw calls only; src/treatments-api.js owns mapping. Starting treatment is the atomic
// Treatment command on the Visit (there is no standalone Visit start/complete command).
export function listTreatments(params) { return request(`/api/treatments${query(params)}`) }
export function getTreatment(id) { return request(`/api/treatments/${encodeURIComponent(id)}`) }
// Cursor-paged (newest first): per_page 1-100, cursor = the previous page's meta.next_cursor.
export function myTreatments(params) { return request(`/api/treatments/mine${query(params)}`) }
export function startTreatment(visitId, payload, key) { return command(`/api/visits/${encodeURIComponent(visitId)}/treatment`, payload, key) }
export function treatmentCommand(id, name, payload, key) { return command(`/api/treatments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, payload, key) }

// M9 Patient Queue Management (entries are created only by M8 arrival). Raw calls only; src/queue-api.js owns mapping.
export function listQueue(params) { return request(`/api/queue${query(params)}`) }
export function myQueue() { return request('/api/queue/mine') }
export function queueCommand(id, name, payload, key) { return command(`/api/queue/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, payload, key) }

// M7 Patient assistant: the ONLY input is the message; the server derives everything else and holds the provider credential.
export function askAssistant(message, history = []) { return request('/api/assistant/messages', { method: 'POST', body: JSON.stringify(history.length ? { message, history } : { message }) }) }
export function assistantInfo() { return request('/api/assistant') }
/**
 * Streams an assistant answer (server-sent events from the clinic server; the AI key never reaches the browser).
 * onEvent(name, data): 'meta' {mode}, 'delta' {text}, 'replace' {text}, 'done' {answer, outcome, mode, actions, handoff}.
 * Resolves with {ok:true, data: <done payload>} or a normal failure ({ok:false, kind, message, code}).
 */
export async function streamAssistant(message, history = [], onEvent = () => {}) {
  let response
  try {
    response = await rawFetch('/api/assistant/stream', { method: 'POST', body: JSON.stringify(history.length ? { message, history } : { message }), headers: { Accept: 'text/event-stream' } })
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the clinic system. Check your connection and try again.' }
  }
  if (!response.ok) return parseFailure(response)
  if (!response.body?.getReader) { const text = await response.text(); return parseSse(text, onEvent) }
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', done = null
  for (;;) {
    const { value, done: finished } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let cut
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2)
      const result = parseSse(chunk + '\n\n', onEvent); if (result.data) done = result.data
    }
    if (finished) break
  }
  if (buffer.trim()) { const result = parseSse(buffer + '\n\n', onEvent); if (result.data) done = result.data }
  return done ? { ok: true, data: done } : { ok: false, kind: 'server', message: 'The assistant stopped before answering. Try again.' }
}
function parseSse(text, onEvent) {
  let done = null
  for (const block of text.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(block)?.[1], raw = /^data: (.+)$/m.exec(block)?.[1]
    if (!name || !raw) continue
    let data = null
    try { data = JSON.parse(raw) } catch { continue }
    onEvent(name, data)
    if (name === 'done') done = data
  }
  return { ok: !!done, data: done }
}

// M7 knowledge base (Owner): the clinic's own assistant answers. Every change is audited by the server.
export function listAssistantAnswers() { return request('/api/assistant-answers') }
export function createAssistantAnswer(payload) { return request('/api/assistant-answers', { method: 'POST', body: JSON.stringify(payload) }) }
export function updateAssistantAnswer(id, payload) { return request(`/api/assistant-answers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }) }
export function testAssistantAnswer(question) { return request('/api/assistant-answers/test', { method: 'POST', body: JSON.stringify({ question }) }) }

// Identity-specific notifications from real server events (each person sees only their own).
export function listNotifications() { return request('/api/notifications') }
export function readNotification(id) { return request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' }) }
export function readAllNotifications() { return request('/api/notifications/read-all', { method: 'POST', body: '{}' }) }

// Patient booking helpers (read-only searches; the booking command is createAppointment).
export function bookingBranchOptions(params) { return request(`/api/appointments/branch-options${query(params)}`) }
export function bookingDentistOptions(params) { return request(`/api/appointments/dentist-options${query(params)}`) }
export function bookingCalendar(params) { return request(`/api/appointments/calendar${query(params)}`) }

// M26 Patient feedback (foundation, Patient only): submit, own history, eligible Visits. Cursor-paged. There is no reviewer API.
export function eligibleFeedbackVisits(params) { return request(`/api/feedback/eligible-visits${query(params)}`) }
export function submitFeedback(payload, key) { return command('/api/feedback', payload, key) }
export function myFeedback(params) { return request(`/api/feedback/mine${query(params)}`) }
export function reviewFeedback(params) { return request(`/api/feedback/review${query(params)}`) }

// M17 in-app human conversations (cursor-paged; a Patient may start a front-desk conversation; no edit/delete route).
export function listConversations(params) { return request(`/api/conversations${query(params)}`) }
export function conversationSummary() { return request('/api/conversations/summary') }
export function listConversationMessages(id, params) { return request(`/api/conversations/${encodeURIComponent(id)}/messages${query(params)}`) }
export function sendConversationMessage(id, body, key) { return command(`/api/conversations/${encodeURIComponent(id)}/messages`, { body }, key) }
// The browser names the NEWEST message it has actually displayed; the server moves this participant's marker forward only.
export function markConversationRead(id, upTo) { return command(`/api/conversations/${encodeURIComponent(id)}/read`, { up_to: upTo }) }
export function closeConversation(id, payload, key) { return command(`/api/conversations/${encodeURIComponent(id)}/close`, payload, key) }
export function conversationStartOptions() { return request('/api/conversations/start-options') }
export function startConversation(payload, key) { return command('/api/conversations', payload, key) }
export function conversationPresence() { return request('/api/conversations/presence', { method: 'POST', body: '{}' }) }
export function conversationDentistOptions(id) { return request(`/api/conversations/${encodeURIComponent(id)}/dentist-options`) }
export function addConversationDentist(id, dentistId) { return request(`/api/conversations/${encodeURIComponent(id)}/participants`, { method: 'POST', body: JSON.stringify({ dentist_id: dentistId }) }) }
// M17 realtime: private-channel authorization for the socket client (same session cookie + CSRF as every call).
export function authorizeChannel(socketId, channelName) { return request('/api/broadcasting/auth', { method: 'POST', body: JSON.stringify({ socket_id: socketId, channel_name: channelName }) }) }

// M16 external inquiries (manually captured by Staff; no social-platform integration). Cursor-paged, newest first.
export function listInquiries(params) { return request(`/api/inquiries${query(params)}`) }
export function inquirySummary() { return request('/api/inquiries/summary') }
export function createInquiry(payload, key) { return command('/api/inquiries', payload, key) }
export function inquiryCommand(id, name, payload, key) { return command(`/api/inquiries/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, payload, key) }

// M13 pricing foundation (Owner-confirmed, effective-dated prices). Raw calls only; src/pricing-api.js owns mapping.
// Cursor-paged (newest first): per_page 1-100, cursor = the previous page's meta.next_cursor.
export function listServicePrices(params) { return request(`/api/service-prices${query(params)}`) }
export function createServicePrice(serviceRef, payload, key) { return command(`/api/services/${encodeURIComponent(serviceRef)}/prices`, payload, key) }
export function retractServicePrice(id, key) { return command(`/api/service-prices/${encodeURIComponent(id)}/retract`, {}, key) }
export function resolveServicePrice(params) { return request(`/api/prices/resolve${query(params)}`) }

// Minimal M12 HMO foundation. Raw calls only; src/hmo-api.js owns mapping.
export function listHmoCases(params) { return request(`/api/hmo-cases${query(params)}`) }
export function myHmoCases() { return request('/api/hmo-cases/mine') }
export function listClaimDecisions(params) { return request(`/api/hmo/claim-decisions${query(params)}`) }
export function hmoGate(visitId) { return request(`/api/visits/${encodeURIComponent(visitId)}/hmo-gate`) }
export function getHmoMembership(patientId) { return request(`/api/patients/${encodeURIComponent(patientId)}/hmo-membership`) }
// Membership changes go through an in-scope Visit: the server derives the Patient from it (no Patient id is sent).
export function setHmoMembership(visitId, payload, key) { return command(`/api/visits/${encodeURIComponent(visitId)}/hmo-membership`, payload, key) }
export function endHmoMembership(visitId, payload, key) { return command(`/api/visits/${encodeURIComponent(visitId)}/hmo-membership/end`, payload, key) }
export function openHmoCase(visitId, key) { return command(`/api/visits/${encodeURIComponent(visitId)}/hmo-case`, {}, key) }
export function hmoSelfPay(visitId, payload, key) { return command(`/api/visits/${encodeURIComponent(visitId)}/hmo/self-pay`, payload, key) }
export function hmoCaseCommand(id, name, payload, key) { return command(`/api/hmo-cases/${encodeURIComponent(id)}/${name}`, payload, key) }

// M11 server-authoritative billing. These calls never write invoices, payments or receipts to browser storage.
// Cursor-paged (newest first): params may carry per_page (1-100), cursor (the previous page's meta.next_cursor), status.
export function listBillingInvoices(params) { return request(`/api/invoices${query(params)}`) }
export function getBillingInvoice(id) { return request(`/api/invoices/${encodeURIComponent(id)}`) }
export function listBillingTreatments() { return request('/api/billing/treatments') }
export function createBillingDraft(treatmentId, key) { return command(`/api/invoices/from-treatment/${encodeURIComponent(treatmentId)}`, {}, key) }
export function reviewBillingInvoice(id, payload, key) { return command(`/api/invoices/${encodeURIComponent(id)}/review`, payload, key) }
export function applyBillingDiscount(id, payload, key) { return command(`/api/invoices/${encodeURIComponent(id)}/discount`, payload, key) }
export function issueBillingInvoice(id, payload, key) { return command(`/api/invoices/${encodeURIComponent(id)}/issue`, payload, key) }
export function recordBillingPayment(id, payload, key) { return command(`/api/invoices/${encodeURIComponent(id)}/payment`, payload, key) }
// Review and Pay: accepted methods in plain words and the billing-address prefill (Patient who owns the invoice, or scoped Staff).
/** Downloads an invoice or receipt PDF (the emailed document) and saves it in the browser. {ok} or a normal failure. */
export async function downloadBillingPdf(invoiceId, kind = 'invoice') {
  let response
  try {
    response = await rawFetch(`/api/invoices/${encodeURIComponent(invoiceId)}/${kind === 'receipt' ? 'receipt-pdf' : 'pdf'}`, { headers: { Accept: 'application/pdf' } })
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the clinic system. Check your connection and try again.' }
  }
  if (!response.ok) return response.status === 404 ? { ok: false, kind: 'not_found', message: 'This document is not available.' } : parseFailure(response)
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || `${kind}.pdf`
  const url = URL.createObjectURL(await response.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true }
}
/** Requests a rate-limited, audited resend of a paid invoice's receipt email. Returns truthful mail transport status. */
export function resendBillingReceipt(invoiceId) {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}/resend-receipt`, { method: 'POST' })
}
/** Downloads an appointment booking deposit receipt PDF and saves it in the browser. */
export async function downloadAppointmentReceiptPdf(appointmentId, code = null) {
  let response
  try {
    response = await rawFetch(`/api/appointments/${encodeURIComponent(appointmentId)}/receipt-pdf`, { headers: { Accept: 'application/pdf' } })
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the clinic system. Check your connection and try again.' }
  }
  if (!response.ok) return response.status === 404 ? { ok: false, kind: 'not_found', message: 'This deposit receipt is not available.' } : parseFailure(response)
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || `Booking-Deposit-Receipt${code ? `-${code}` : ''}.pdf`
  const url = URL.createObjectURL(await response.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true }
}

/** M19: downloads a prescription PDF (issued or void) the signed-in person may read. */
export async function downloadPrescriptionPdf(id, number = null) {
  let response
  try {
    response = await rawFetch(`/api/prescriptions/${encodeURIComponent(id)}/pdf`, { headers: { Accept: 'application/pdf' } })
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the clinic system. Check your connection and try again.' }
  }
  if (!response.ok) return response.status === 404 ? { ok: false, kind: 'not_found', message: 'This document is not available.' } : parseFailure(response)
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || `Prescription${number ? `-${number}` : ''}.pdf`
  const url = URL.createObjectURL(await response.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true }
}
// M10 Dental Charts
export function patientChart(patientId) { return request(`/api/patients/${encodeURIComponent(patientId)}/chart`) }
export function recordChartEntry(patientId, body) { return json(`/api/patients/${encodeURIComponent(patientId)}/chart`, 'POST', body) }
export function myChart(patientId = null) { return request(`/api/me/chart${patientId ? `?patient_id=${encodeURIComponent(patientId)}` : ''}`) }
// M20 Patient Follow-Up
export function followups(filters = {}) { const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(); return request(`/api/followups${q ? `?${q}` : ''}`) }
export function patientFollowups(patientId) { return request(`/api/patients/${encodeURIComponent(patientId)}/followups`) }
export function createFollowup(body) { return json('/api/followups', 'POST', body) }
export function updateFollowup(id, body) { return json(`/api/followups/${encodeURIComponent(id)}`, 'PATCH', body) }
// M19 Prescriptions
export function listPrescriptions(params = {}) { return request(`/api/prescriptions${query(params)}`) }
export function myPrescriptions() { return request('/api/me/prescriptions') }
export function prescription(id) { return request(`/api/prescriptions/${encodeURIComponent(id)}`) }
export function prescriptionVisits() { return request('/api/prescriptions/visits') }
export function createPrescription(body) { return json('/api/prescriptions', 'POST', body) }
export function updatePrescription(id, body) { return json(`/api/prescriptions/${encodeURIComponent(id)}`, 'PUT', body) }
export function issuePrescription(id, revision) { return json(`/api/prescriptions/${encodeURIComponent(id)}/issue`, 'POST', { expected_revision: revision }) }
export function voidPrescription(id, reason) { return json(`/api/prescriptions/${encodeURIComponent(id)}/void`, 'POST', { reason }) }
export function savePrescriptionLicense(value) { return json('/api/me/prescription-license', 'PUT', { rx_license_no: value }) }
export function getPaymentOptions(invoiceId) { return request(`/api/invoices/${encodeURIComponent(invoiceId)}/payment-options`) }
export function createPayMongoCheckout(invoiceId, payload = {}) {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}/paymongo-checkout`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
// White-label settings (Owner): clinic identity, contact, design, colours, logo and per-branch BIR fields.
export function getBrandingSettings() { return request('/api/settings/branding') }
export function updateBrandingSettings(payload) { return request('/api/settings/branding', { method: 'PUT', body: JSON.stringify(payload) }) }
export function uploadBrandingLogo(file) { const form = new FormData(); form.append('logo', file); return request('/api/settings/branding/logo', { method: 'POST', body: form }) }
export function resetBrandingLogo() { return request('/api/settings/branding/logo', { method: 'DELETE' }) }
export function updateBranchBir(branchId, payload) { return request(`/api/settings/branches/${encodeURIComponent(branchId)}/bir`, { method: 'PUT', body: JSON.stringify(payload) }) }
// M1 employee invitations (Owner) and public acceptance.
export function listEmployeeInvitations() { return request('/api/employee-invitations') }
export function createEmployeeInvitation(payload) { return request('/api/employee-invitations', { method: 'POST', body: JSON.stringify(payload) }) }
export function resendEmployeeInvitation(id) { return request(`/api/employee-invitations/${encodeURIComponent(id)}/resend`, { method: 'POST', body: '{}' }) }
export function cancelEmployeeInvitation(id) { return request(`/api/employee-invitations/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }) }
export function acceptEmployeeInvitation(payload) { return request('/api/invitations/accept', { method: 'POST', body: JSON.stringify(payload) }) }
export function sendTestEmail(recipientEmail) {
  return request('/api/mail/test', {
    method: 'POST',
    body: JSON.stringify(recipientEmail ? { recipient_email: recipientEmail } : {}),
  })
}
export function myBillingInvoices(params) { return request(`/api/invoices/mine${query(params)}`) }
// Cursor-paged like the invoice lists (per_page 1-100, cursor = previous meta.next_cursor). The Patient billing page reads receipts from its paged invoices.
export function myBillingReceipts(params) { return request(`/api/receipts/mine${query(params)}`) }

// M14 Patient Forms, Documents & Consent Management
export function listDocuments(params) { return request(`/api/documents${query(params)}`) }
export function myDocuments() { return request('/api/documents/mine') }
export function getDocument(id) { return request(`/api/documents/${encodeURIComponent(id)}`) }
export function uploadDocument(formData, key) {
  return request('/api/documents', {
    method: 'POST',
    body: formData,
    headers: key ? { 'Idempotency-Key': key } : {},
  })
}
export function retractDocument(id, payload, key) {
  return command(`/api/documents/${encodeURIComponent(id)}/retract`, payload, key)
}
export function listPatientConsents(patientId) {
  return request(`/api/patients/${encodeURIComponent(patientId)}/consents`)
}
export function myConsents() { return request('/api/consents/mine') }
export function grantPatientConsent(patientId, payload, key) {
  return command(`/api/patients/${encodeURIComponent(patientId)}/consents`, payload, key)
}
export function withdrawPatientConsent(patientId, consentId, key) {
  return command(`/api/patients/${encodeURIComponent(patientId)}/consents/${encodeURIComponent(consentId)}/withdraw`, {}, key)
}

// M22 Audit Trail & Activity Monitoring Management (Owner only)
export function listAuditLogs(params) { return request(`/api/audit-logs${query(params)}`) }
export function getAuditLog(id) { return request(`/api/audit-logs/${encodeURIComponent(id)}`) }

// M23 Workflow Automation & Exception Management (Owner only)
export function getAutomationSnapshot(branchId) {
  const q = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''
  return request(`/api/automation/snapshot${q}`)
}
export function listAutomationRules() { return request('/api/automation/rules') }
export function listAutomationActions(params) { return request(`/api/automation/actions${query(params)}`) }
export function dispatchAutomationRule(ruleCode, payload) {
  return command('/api/automation/dispatch', { rule_code: ruleCode, payload })
}

// M21 Operational Analytics & Executive Intelligence (Owner only)
export function getExecutiveSummary(params) { return request(`/api/analytics/executive-summary${query(params)}`) }
export function getBranchPerformance(params) { return request(`/api/analytics/branch-performance${query(params)}`) }
export function getDailyRevenue(params) { return request(`/api/analytics/daily-revenue${query(params)}`) }
export function getWeeklyRevenueHistogram(params) { return request(`/api/analytics/weekly-histogram${query(params)}`) }

// Scheduled automations (Administration → Automations, Owner). Settings changes carry the revision they were based on.
export function listAutomations() { return request('/api/automations') }
export function updateAutomation(key, body) { return request(`/api/automations/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }) }
export function testAutomation(key) { return request(`/api/automations/${encodeURIComponent(key)}/test`, { method: 'POST' }) }
/** Demo database only (the server refuses elsewhere): run one automation now with a simulated clock. */
export function runAutomationDemo(body) { return request('/api/automations/demo-run', { method: 'POST', body: JSON.stringify(body) }) }
// A2 possible no-shows (front desk): confirm uses the existing No-show command; undo leaves the appointment unchanged.
export function listNoShowFlags() { return request('/api/no-show-flags') }
export function confirmNoShowFlag(id) { return request(`/api/no-show-flags/${encodeURIComponent(id)}/confirm`, { method: 'POST' }) }
export function dismissNoShowFlag(id) { return request(`/api/no-show-flags/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }) }
// A5 waitlist for fully booked days (Patient's own entries).
export function myWaitlist() { return request('/api/waitlist/mine') }
export function joinWaitlist(body) { return request('/api/waitlist', { method: 'POST', body: JSON.stringify(body) }) }
export function cancelWaitlist(id) { return request(`/api/waitlist/${encodeURIComponent(id)}/cancel`, { method: 'POST' }) }
const json = (path, method, body) => request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const enc = encodeURIComponent
// Interview round 2. F1 message wording (Owner edits, previews, tests and approves; a Dentist approves recall wording).
export function listMessageTemplates() { return request('/api/message-templates') }
export function updateMessageTemplate(key, body) { return json(`/api/message-templates/${enc(key)}`, 'PUT', body) }
export function approveMessageTemplate(key, revision) { return json(`/api/message-templates/${enc(key)}/approve`, 'POST', { expected_revision: revision }) }
export function dentistApproveMessageTemplate(key, revision) { return json(`/api/message-templates/${enc(key)}/dentist-approve`, 'POST', { expected_revision: revision }) }
export function previewMessageTemplate(key, draft) { return json(`/api/message-templates/${enc(key)}/preview`, 'POST', draft || {}) }
export function testMessageTemplate(key) { return json(`/api/message-templates/${enc(key)}/test`, 'POST') }
// F1–F3 one-time email links (no sign-in): describe, then perform (cancel and move-up need confirm: true).
export function describeResponseLink(token) { return request(`/api/public/respond?token=${enc(token)}`) }
export function performResponseLink(token, confirm = false) { return json('/api/public/respond', 'POST', { token, confirm }) }
// F2–F4 front desk.
export function frontDeskToday() { return request('/api/front-desk/today') }
export function undoNoShow(appointmentId, revision) { return json(`/api/front-desk/appointments/${enc(appointmentId)}/undo-no-show`, 'POST', { expected_revision: revision }) }
export function useFreeTimeForWalkIn(openingId) { return json(`/api/slot-openings/${enc(openingId)}/walk-in`, 'POST') }
export function confirmAppointment(appointmentId, revision) { return json(`/api/appointments/${enc(appointmentId)}/confirm`, 'POST', { expected_revision: revision }) }
export function clearAttendanceFlag(patientId, reason) { return json(`/api/patients/${enc(patientId)}/attendance/clear`, 'POST', { reason }) }
// F2–F3 patient answers in the app.
export function sayOnMyWay(appointmentId) { return json(`/api/appointments/${enc(appointmentId)}/on-my-way`, 'POST') }
export function mySlotOffers() { return request('/api/slot-offers/mine') }
export function acceptSlotOffer(offerId) { return json(`/api/slot-offers/${enc(offerId)}/accept`, 'POST') }
// F5 closed dates.
export function listClosures() { return request('/api/branch-closures') }
export function createClosure(body) { return json('/api/branch-closures', 'POST', body) }
export function changeClosure(id, action) { return json(`/api/branch-closures/${enc(id)}`, 'PATCH', { action }) }
export function suggestHolidays() { return json('/api/branch-closures/suggest-holidays', 'POST') }
export function closureAffected(id) { return request(`/api/branch-closures/${enc(id)}/affected`) }
export function notifyClosurePatients(id) { return json(`/api/branch-closures/${enc(id)}/notify`, 'POST') }
export function publicClosures() { return request('/api/public/closures') }
// F6 calendar load.
export function calendarLoad(params) { return request(`/api/calendar/load${query(params)}`) }
// F7 online booking mode per service (Owner).
export function setServiceOnlineBooking(serviceId, body) { return json(`/api/services/${enc(serviceId)}/online-booking`, 'PATCH', body) }
// F8 accepted HMOs (information only) and the patient's own HMO details.
export function listAcceptedHmos() { return request('/api/accepted-hmos') }
export function addAcceptedHmo(body) { return json('/api/accepted-hmos', 'POST', body) }
export function updateAcceptedHmo(id, body) { return json(`/api/accepted-hmos/${enc(id)}`, 'PATCH', body) }
export function publicHmos() { return request('/api/public/hmos') }
export function publicFaq() { return request('/api/public/faq') }
// Registration intake (counter QR / kiosk, no sign-in). X-Device-Id is a random id this browser keeps, for rate limits only (src/intake/device-id.js).
export function intakeBranch(ref) { return request(`/api/public/intake/${enc(ref)}`) }
export function submitIntake(body) { return request('/api/public/intake', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Device-Id': deviceId() } }) }
export function joinQueueWithAccount(body) { return request('/api/intake/join', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Device-Id': deviceId() } }) }
export function claimAccount(body) { return json('/api/account/claim', 'POST', body) }
export function verifyClaim(body) { return json('/api/account/claim/verify', 'POST', body) }
// Staff: today's counter code, pending registrations, confirm or cancel, the in-person ID check, the branch poster.
export function intakeCode(branchRef) { return request(`/api/intake/code${branchRef ? `?branch_ref=${enc(branchRef)}` : ''}`) }
export function refreshIntakeCode(branchRef) { return json('/api/intake/code/refresh', 'POST', branchRef ? { branch_ref: branchRef } : {}) }
export function pendingIntake() { return request('/api/intake/submissions') }
export function confirmIntake(id, body) { return json(`/api/intake/submissions/${enc(id)}/confirm`, 'POST', body) }
export function cancelIntake(id) { return json(`/api/intake/submissions/${enc(id)}/cancel`, 'POST') }
// M3 Work Schedules
export function workSchedules() { return request('/api/work-schedules') }
export function saveWeeklyHours(dentistId, body) { return json(`/api/work-schedules/${enc(dentistId)}/weekly`, 'PUT', body) }
export function copyProfileHours(dentistId, branchRef) { return json(`/api/work-schedules/${enc(dentistId)}/from-profile`, 'POST', { branch_ref: branchRef }) }
export function addScheduleException(dentistId, body) { return json(`/api/work-schedules/${enc(dentistId)}/exceptions`, 'POST', body) }
export function removeScheduleException(id) { return json(`/api/work-schedule-exceptions/${enc(id)}`, 'PATCH', { action: 'remove' }) }
export function scheduleAffected(dentistId) { return request(`/api/work-schedules/${enc(dentistId)}/affected`) }
export function notifyScheduleAffected(dentistId) { return json(`/api/work-schedules/${enc(dentistId)}/notify`, 'POST') }
// M15 Leave Management
export function myLeave() { return request('/api/leave/mine') }
export function requestLeave(body) { return json('/api/leave', 'POST', body) }
export function leaveRequests(filters = {}) { const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(); return request(`/api/leave${q ? `?${q}` : ''}`) }
export function leaveCalendar(from, to) { return request(`/api/leave/calendar?from=${enc(from)}&to=${enc(to)}`) }
export function leaveConflicts(id) { return request(`/api/leave/${enc(id)}/conflicts`) }
export function decideLeave(id, decision) { return json(`/api/leave/${enc(id)}/decide`, 'POST', { decision }) }
export function cancelLeave(id) { return json(`/api/leave/${enc(id)}/cancel`, 'POST') }
export function notifyLeaveAffected(id) { return json(`/api/leave/${enc(id)}/notify`, 'POST') }
// M25 Patient Handovers
export function handovers(filters = {}) { const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(); return request(`/api/handovers${q ? `?${q}` : ''}`) }
export function handover(id) { return request(`/api/handovers/${enc(id)}`) }
export function createHandover(body) { return json('/api/handovers', 'POST', body) }
export function acknowledgeHandover(id) { return json(`/api/handovers/${enc(id)}/acknowledge`, 'POST') }
export function cancelHandover(id) { return json(`/api/handovers/${enc(id)}/cancel`, 'POST') }
export function requestHandover(patientId, fromBranchRef = null) { return json('/api/handovers/request', 'POST', { patient_id: patientId, from_branch_ref: fromBranchRef }) }
export function offerOnlineAccount(patientId, body) { return json(`/api/patients/${enc(patientId)}/offer-account`, 'POST', body) }
export function verifyPatientId(patientId, body) { return json(`/api/patients/${enc(patientId)}/verify-id`, 'POST', body) }
export function branchPosterUrl(branchRef) { return `${apiBase()}/api/branches/${enc(branchRef)}/poster` }
// Parents and guardians.
export function myDependents() { return request('/api/me/dependents') }
export function addDependent(body) { return json('/api/me/dependents', 'POST', body) }
export function inviteToClaim(patientId, email) { return json(`/api/patients/${enc(patientId)}/claim-invite`, 'POST', { email }) }
export function linkGuardian(patientId, body) { return json(`/api/patients/${enc(patientId)}/guardians`, 'POST', body) }
export function myHmo() { return request('/api/me/hmo') }
export function saveMyHmo(body) { return json('/api/me/hmo', 'PUT', body) }
