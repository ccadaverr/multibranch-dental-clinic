import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDrafts } from '../src/message-drafts.js'
import { mapConnectionState, realtimeConfig, realtimeState, startRealtime } from '../src/realtime.js'
import * as api from '../src/api-client.js'
import { loadConversations, loadNewerMessages, startConversation } from '../src/messaging-api.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let calls
beforeEach(() => {
  calls = []
  globalThis.document = { cookie: 'XSRF-TOKEN=abc' }
  api.__resetCsrfCacheForTests()
})
const respond = body => { globalThis.fetch = async (url, options) => { calls.push({ url, options }); return url.endsWith('/sanctum/csrf-cookie') ? json(204, null) : json(200, body) } }

// ---- acceptance: a draft never carries over into another conversation ----------------------------------------------------

test('each conversation keeps its own draft and key; switching never moves text between Patients', () => {
  let n = 0
  const drafts = createDrafts(() => `k${++n}`)
  drafts.setText('conv-A', 'For Patient A: your x-ray is ready')
  assert.equal(drafts.text('conv-B'), '', 'opening B shows an empty composer, not A’s draft')
  drafts.setText('conv-B', 'For Patient B: see you Monday')
  const sendB = drafts.snapshot('conv-B')
  assert.deepEqual([sendB.conversationId, sendB.text], ['conv-B', 'For Patient B: see you Monday'])
  assert.equal(drafts.text('conv-A'), 'For Patient A: your x-ray is ready', 'A is untouched')
  drafts.sent(sendB)
  assert.equal(drafts.text('conv-B'), '')
  assert.equal(drafts.text('conv-A'), 'For Patient A: your x-ray is ready')
  const a1 = drafts.snapshot('conv-A')
  assert.equal(drafts.snapshot('conv-A').key, a1.key, 'a retry of unchanged text reuses its key (no double post)')
  drafts.setText('conv-A', 'edited')
  assert.notEqual(drafts.snapshot('conv-A').key, a1.key, 'edited text is a new request')
  assert.notEqual(drafts.snapshot('conv-A').key, sendB.key, 'keys are never shared between conversations')
})

test('a stale confirmation cannot clear a newer draft', () => {
  const drafts = createDrafts()
  drafts.setText('c', 'first')
  const snap = drafts.snapshot('c')
  drafts.setText('c', 'second, typed while the first was sending')
  drafts.sent(snap)
  assert.equal(drafts.text('c'), 'second, typed while the first was sending')
})

// ---- realtime status and fallback ---------------------------------------------------------------------------------------

test('connection states map to what the status chip says', () => {
  assert.equal(mapConnectionState('connected'), 'live')
  assert.equal(mapConnectionState('unavailable'), 'reconnecting')
  assert.equal(mapConnectionState('disconnected'), 'reconnecting')
  assert.equal(mapConnectionState('failed'), 'offline')
})

test('without Reverb configured the client stays in polling mode instead of failing', async () => {
  assert.equal(realtimeConfig(), null)
  assert.equal(await startRealtime(), null)
  assert.equal(realtimeState(), 'disabled')
})

// ---- API contract ---------------------------------------------------------------------------------------------------------

test('the sync read asks for messages after the last one shown (same endpoint as polling)', async () => {
  respond({ data: [{ id: 'm2', body: 'hi', sender: { name: 'A', role: 'Staff' }, mine: false, sent_at: '2026-10-13T10:00:00+08:00' }], meta: {context:{conversation_id:'c1',patient_id:'p',branch_id:'b'}, more: false } })
  const result = await loadNewerMessages('c1', 'm1')
  assert.match(calls.at(-1).url, /\/api\/conversations\/c1\/messages\?after=m1&per_page=100$/)
  assert.deepEqual(result.rows.map(r => r.id), ['m2'])
})

test('starting a conversation sends the branch and text with an Idempotency-Key', async () => {
  respond({ data: { conversation: { id: 'c9', reused: false }, message: { id: 'm1', body: 'Hello', sender: { name: 'P', role: 'Patient' }, mine: true, sent_at: '2026-11-14T10:00:00+08:00' } } })
  const result = await startConversation('b1', '  Hello  ', 'key-1')
  const last = calls.at(-1)
  assert.match(last.url, /\/api\/conversations$/)
  assert.deepEqual(JSON.parse(last.options.body), { branch_id: 'b1', body: 'Hello' })
  assert.equal(last.options.headers['Idempotency-Key'], 'key-1')
  assert.deepEqual([result.conversationId, result.reused, result.message.body], ['c9', false, 'Hello'])
  assert.equal((await startConversation('', 'x', 'k')).ok, false)
})

test('the inbox channels to subscribe come from the server', async () => {
  respond({ data: [], meta: { channels: ['branch-inbox.01abc'] } })
  assert.deepEqual((await loadConversations()).channels, ['branch-inbox.01abc'])
})

test('the chat screen renders text only and the socket client never handles message text', () => {
  const page = readFileSync(new URL('../src/pages/ServerMessages.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|localStorage|sessionStorage/)
  const realtime = readFileSync(new URL('../src/realtime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(realtime, /\.body\b/)
})
