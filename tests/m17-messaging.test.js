import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import * as messaging from '../src/messaging-api.js'
import { world } from './support/mock-server-world.js'

// M17 client behaviour: in a clinic-server session the server is the only conversation/message authority. Messages are in-app human
// messages — never SMS/e-mail/social, never "delivered/seen/typing/online".

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: {} })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers || {} }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const posts = () => calls.filter(c => c.method === 'POST')
const msg = (n, over = {}) => ({ id: `01k00000000000000000000m0${n}`, body: `message ${n}`, sender: { name: 'Staff Name', role: 'Staff' }, mine: false, sent_at: '2026-09-28T10:00:00+08:00', ...over })

test('grant options require exact conversation Patient and branch context and a valid revision', async () => {
  const data=[{id:'dentist-a',name:'Synthetic Dentist',participant:false}]
  const meta={grant_required:true,revision:7,context:{conversation_id:'conversation-a',patient_id:'patient-a',branch_id:'b1'}}
  stubFetch(json(200,{data,meta}))
  assert.deepEqual(await messaging.loadDentistOptions('conversation-a',{patientId:'patient-a',branchId:'b1'}),
    {ok:true,rows:data,grantRequired:true,revision:7,patientId:'patient-a',branchId:'b1'})
  for(const context of [{patientId:'foreign',branchId:'b1'},{patientId:'patient-a',branchId:'b2'},null]){
    stubFetch(json(200,{data,meta}));assert.equal((await messaging.loadDentistOptions('conversation-a',context)).ok,false)
  }
  stubFetch(json(200,{data}));assert.equal((await messaging.loadDentistOptions('conversation-a',{patientId:'patient-a',branchId:'b1'})).ok,false,'An unverified legacy options contract cannot authorize reassignment.')
})

test('a grant request carries its original key and CAS revision while a receipt must match every selected identity', async () => {
  const grant={key:'original-grant-key',revision:7,reason:'Synthetic approved reassignment',patientId:'patient-a',branchId:'b1'}
  const data={id:'conversation-a',grant_id:'grant-a',dentist_id:'dentist-a',patient_id:'patient-a',branch_id:'b1',revision:8,changed:true}
  assert.equal((await messaging.addDentist('conversation-a','dentist-a',()=>true)).kind,'validation');assert.equal(calls.length,0)
  stubFetch(json(200,{}),json(201,{data}))
  assert.deepEqual(await messaging.addDentist('conversation-a','dentist-a',()=>true,grant),{ok:true,added:true,revision:8})
  assert.deepEqual(posts()[0].body,{dentist_id:'dentist-a',expected_revision:7,reason:grant.reason})
  assert.equal(posts()[0].headers['Idempotency-Key'],grant.key)
  for(const patch of [{id:'foreign'},{dentist_id:'foreign'},{patient_id:'foreign'},{branch_id:'b2'},{grant_id:''},{revision:9}]){
    api.__resetCsrfCacheForTests();stubFetch(json(200,{}),json(201,{data:{...data,...patch}}))
    assert.equal((await messaging.addDentist('conversation-a','dentist-a',()=>true,grant)).kind,'unconfirmed')
  }
})

test('a message is sent as {body} only, trimmed, with an Idempotency-Key; the sender is never supplied by the browser', async () => {
  stubFetch(json(200, {}), json(201, { data: msg(1, { mine: true, body:'Hello' }) }))
  const result = await messaging.sendMessage('01k0000000000000000000c001', '  Hello  ', 'key-1')
  assert.deepEqual([result.ok, result.message.body, result.message.mine], [true, 'Hello', true])
  assert.deepEqual(posts()[0].body, { body: 'Hello' })
  assert.equal(posts()[0].headers['Idempotency-Key'], 'key-1')
  assert.ok(posts()[0].url.endsWith('/api/conversations/01k0000000000000000000c001/messages'))
})

test('marking read names the newest displayed message and nothing else; with nothing displayed nothing is sent', async () => {
  stubFetch(json(200, {}), json(200, { data: { read: true } }))
  assert.deepEqual(await messaging.markRead('conv', '01k00000000000000000000m05'), { ok: true })
  assert.deepEqual(posts()[0].body, { up_to: '01k00000000000000000000m05' })
  assert.ok(posts()[0].url.endsWith('/api/conversations/conv/read'))
  const before = calls.length
  assert.deepEqual(await messaging.markRead('conv', null), { ok: true, skipped: true })
  assert.equal(calls.length, before)
  const page = read('src/pages/ServerMessages.jsx')
  // Read state follows the newest DISPLAYED server message of the selected conversation (pending sends are not server messages).
  assert.match(page, /const newestShown = thread\?\.messages\?\.length \? thread\.messages\[thread\.messages\.length - 1\]\.id : null/)
  assert.match(page, /markRead\(selectedId, newestShown, \(\) => owns\(\) && selectedRef.current===selectedId\)\.then\(r => \{ if \(current && owns\(\) && r\.ok\) refreshList\(\) \}\)/)
  assert.doesNotMatch(page, /unread: 0/, 'the browser never decides the unread count; it re-reads the server')
})

test('empty or oversized text never reaches the network', async () => {
  stubFetch(json(200, {}))
  for (const bad of ['', '  ', null, undefined, 'x'.repeat(messaging.MAX_MESSAGE + 1)]) assert.deepEqual([(await messaging.sendMessage('c', bad, 'k')).ok, (await messaging.sendMessage('c', bad, 'k')).kind], [false, 'validation'])
  assert.equal(calls.length, 0)
})

test('failures are explicit and keep the information needed to retry: 422 closed, 429 with a wait, network, 500', async () => {
  stubFetch(json(200, {}), json(422, { message: 'This conversation is closed and cannot receive new messages.', code: 'conversation_closed' }))
  const closed = await messaging.sendMessage('c', 'hi', 'k')
  assert.deepEqual([closed.ok, closed.code], [false, 'conversation_closed'])
  api.__resetCsrfCacheForTests()
  stubFetch(json(200, {}), json(429, { message: 'You are sending messages very quickly.', code: 'messages_rate_limited', retry_after: 17 }))
  const limited = await messaging.sendMessage('c', 'hi', 'k')
  assert.deepEqual([limited.ok, limited.kind, limited.retry_after], [false, 'rate_limited', 17])
  api.__resetCsrfCacheForTests()
  globalThis.fetch = async () => { throw new TypeError('offline') }
  assert.equal((await messaging.sendMessage('c', 'hi', 'k')).kind, 'network')
  api.__resetCsrfCacheForTests()
  stubFetch(json(200, {}), json(500, { message: 'boom' }))
  assert.equal((await messaging.sendMessage('c', 'hi', 'k')).ok, false)
})

test('history is read newest-first through the server cursor; a failed older page is an error, never a shorter history', async () => {
  stubFetch(json(200, { data: [msg(3), msg(2)], meta: {context:{conversation_id:'conv',patient_id:'p',branch_id:'b'}, per_page: 30, next_cursor: 'c1' } }))
  const page = await messaging.loadMessages('conv')
  assert.deepEqual([page.ok, page.rows.map(r => r.body), page.nextCursor], [true, ['message 3', 'message 2'], 'c1'])
  assert.match(calls.at(-1).url, /per_page=30/)
  stubFetch(json(200, { data: [msg(1)], meta: {context:{conversation_id:'conv',patient_id:'p',branch_id:'b'}, per_page: 30, next_cursor: null } }))
  assert.equal((await messaging.loadMessages('conv', 'c1')).nextCursor, null)
  assert.match(calls.at(-1).url, /cursor=c1/)
  stubFetch(json(500, { message: 'boom' }))
  const failed = await messaging.loadMessages('conv', 'c1')
  assert.equal(failed.ok, false); assert.equal(failed.rows, undefined)
})

test('counts come only from the server: failure, forbidden and unreadable summaries are never zero', async () => {
  stubFetch(json(200, { data: { conversations: 0, open: 0, unread_conversations: 0 } }))
  const zero = await messaging.loadConversationSummary()
  assert.deepEqual([zero.ok, zero.unread], [true, 0], 'a genuine server zero is a zero')
  for (const response of [json(500, { message: 'boom' }), json(403, { message: 'no' }), json(200, { data: {} }), json(200, { data: { conversations: 1, unread_conversations: 'x' } })]) {
    stubFetch(response)
    const result = await messaging.loadConversationSummary()
    assert.equal(result.ok, false)
    assert.equal('unread' in result, false)
  }
})

test('message text stays a plain string and is rendered only as React text; no link, fetch or HTML path exists', () => {
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script> https://evil.example'
  assert.equal(messaging.mapMessage(msg(4, { body: xss })).body, xss)
  const page = read('src/pages/ServerMessages.jsx')
  assert.doesNotMatch(page + read('src/messaging-api.js'), /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/)
  assert.doesNotMatch(page, /<a\s|href=|window\.open|fetch\(/)
})

test('the screen claims only what is real: in-app messages, no delivery/seen/typing/online, no local storage, no timers of its own', () => {
  const page = read('src/pages/ServerMessages.jsx')
  const visible = page.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  // Priority 2: an offline Patient may get a content-free email alert, so the screen says exactly that.
  assert.match(visible, /These messages stay inside this application\. Nothing is sent by SMS or social media, and “unread” only means not yet opened here/)
  assert.match(visible, /we email you a short alert — never the message itself/)
  assert.doesNotMatch(visible, /\b(Delivered|Seen|Typing|typing\.\.\.|Online|Synced|Read receipt|Read at)\b/)
  assert.doesNotMatch(visible + read('src/messaging-api.js'), /localStorage|sessionStorage|indexedDB|setTimeout|setInterval/)
  assert.match(visible, /useVisibleRefresh/)
  for (const text of ['Load older messages', 'Older messages unavailable', 'Retry', 'Looking|Loading messages', 'Conversations unavailable', 'No conversations yet']) assert.match(visible, new RegExp(text))
  assert.match(visible, /maxLength=\{MAX_MESSAGE\}/)
  // A retry resends the failed item with ITS key (never a new one); keys and drafts are per conversation (tests/m17-realtime-messaging.test.js).
  assert.match(visible, /const snapshot = drafts\.current\.snapshot\(selected\.id\)/)
  assert.match(visible, /onClick=\{\(\) => deliver\(selected\.id, p\)\}>Retry/)
})

test('dispatch: a clinic-server session always uses the server page; the demo is isolated; dashboards and the badge never use demo conversations', () => {
  const fc = read('src/pages/FinanceCommunication.jsx')
  assert.match(fc, /if\(store\.session\?\.serverUserId\)return <ServerMessagesPage/)
  assert.match(fc, /function DemoMessagesPage/)
  assert.match(read('src/pages/Dashboards.jsx'), /Active conversations" value=\{session\?\.serverUserId\?'Not available to Owner'/)
  const layout = read('src/layout.jsx')
  assert.match(layout, /loadConversationSummary\(\)\.then\(r=>\{if\(live\)setServerUnread\(r\.ok\?r\.unread:null\)\}\)/)
  assert.match(layout, /session\?\.serverUserId\?\(Number\.isInteger\(serverUnread\)\?serverUnread:0\):patientConversations/)
})

test('in a clinic-server session the local conversation commands refuse; they remain only for the offline demo', () => {
  const w = world()
  w.session.serverUserId = '01K00000000000000000000010'
  for (const result of [w.actions.replyToConversation('c1', 'hi', 'cmd'), w.actions.markConversationRead('c1'), w.actions.closeConversation('c1')]) {
    assert.equal(result.ok, false)
    assert.match(result.message, /clinic server/)
  }
})

test('undecryptable message displays neutral fallback text without exposing internal error or key rotation details', () => {
  const model = read('backend/app/Models/ConversationMessage.php')
  assert.match(model, /This message can't be displayed/)
  assert.doesNotMatch(model, /Message encrypted with a previous clinic key/)
  const page = read('src/pages/ServerMessages.jsx')
  assert.match(page, /<p>\{m\.body\}<\/p>/)
})

test('STF-21..24 & DEN-14: Switch dentist label, distinct sender/receiver chat bubbles, message search with highlighting, and scrollable thread', async () => {
  const page = read('src/pages/ServerMessages.jsx')
  const css = read('src/foundation.css')

  // STF-21: Switch dentist label and button
  assert.match(page, /Switch dentist/)
  assert.doesNotMatch(page, />Add dentist</)
  assert.match(page, /Dentist to switch to/)

  // STF-22: Distinct sender (.mine) and receiver (.theirs) chat bubble classes and colors
  assert.match(page, /chat-bubble \$\{m\.mine \? 'mine' : 'theirs'\}/)
  assert.match(css, /\.chat-bubble,\s*\.chat-bubble\.theirs\s*\{[^}]*align-self:\s*flex-start;[^}]*background:\s*var\(--surface-2/s)
  assert.match(css, /\.chat-bubble\.mine\s*\{[^}]*align-self:\s*flex-end;[^}]*background:\s*var\(--brand-3/s)

  // STF-23: Shared SearchInput in messages with keyword/contact search, match highlighting, and empty state
  assert.match(page, /<SearchInput className="chat-search"/)
  assert.match(page, /No matching messages or contacts/)
  assert.match(page, /className="chat-highlight"/)
  stubFetch(json(200, { data: [], meta: { next_cursor: null, channels: [] } }))
  await messaging.loadConversations(null, 'Reyes')
  assert.match(calls.at(-1).url, /q=Reyes/)

  // STF-24 & DEN-14: Scrollable list and log with auto-scroll to latest message shared across Staff and Dentist
  assert.match(css, /\.chat-log\s*\{[^}]*overflow-y:\s*auto;[^}]*scroll-behavior:\s*smooth;/s)
  assert.match(page, /el\.scrollTop = el\.scrollHeight/)
})
