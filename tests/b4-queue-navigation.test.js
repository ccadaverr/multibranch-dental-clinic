import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import { findPatientConversation, mapConversation } from '../src/messaging-api.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: {} })
const conversation = (id, patientId, branchId) => ({ id, patient: { id: patientId, code: 'P-100', name: 'Fictional Patient' }, branch: { id: branchId, name: 'Branch' }, status: 'Open' })
let calls
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })
const stub = (...responses) => { let i = 0; globalThis.fetch = async url => { calls.push(String(url)); return responses[Math.min(i++, responses.length - 1)] } }

test('queue message lookup uses server-visible Patient and branch identities across pages', async () => {
  stub(
    json(200, { data: [conversation('wrong', 'other-patient', 'b1')], meta: { next_cursor: 'more' } }),
    json(200, { data: [conversation('other-branch', 'p1', 'b2'), conversation('right', 'p1', 'b1')], meta: { next_cursor: null } }),
  )
  const result = await findPatientConversation('p1', 'b1', 'P-100')
  assert.equal(result.conversation.id, 'right')
  assert.deepEqual([result.conversation.patientId, result.conversation.branchId], ['p1', 'b1'])
  assert.match(calls[0], /q=P-100/)
  assert.match(calls[1], /cursor=more/)
})

test('missing, mismatched, and failed conversation reads never return another Patient thread', async () => {
  assert.equal((await findPatientConversation(null, 'b1', 'P-100')).conversation, null)
  assert.equal(calls.length, 0)
  stub(json(200, { data: [conversation('wrong', 'p2', 'b1')], meta: { next_cursor: null } }))
  assert.equal((await findPatientConversation('p1', 'b1', 'P-100')).conversation, null)
  stub(json(403, { message: 'Forbidden' }))
  assert.equal((await findPatientConversation('p1', 'b1', 'P-100')).ok, false)
  assert.deepEqual([mapConversation(conversation('right', 'p1', 'b1')).patientId, mapConversation(conversation('right', 'p1', 'b1')).branchId], ['p1', 'b1'])
})

test('obsolete queue message lookup stops before another page or navigation result',async()=>{
 let current=true
 globalThis.fetch=async url=>{calls.push(String(url));current=false;return json(200,{data:[],meta:{next_cursor:'older'}})}
 assert.equal((await findPatientConversation('p1','b1','P-100',()=>current)).kind,'superseded')
 assert.equal(calls.length,1)
 assert.equal((await findPatientConversation('p1','b1','P-100',()=>current)).kind,'superseded')
 assert.equal(calls.length,1)
})

test('Live Queue rows support keyboard chart navigation and independent server Call and Message actions', () => {
  const page = read('src/pages/PatientFlow.jsx')
  assert.match(page, /<tr role="row"[^>]*className="queue-open-row" tabIndex=\{0\}/)
  assert.match(page, /e\.key === 'Enter' \|\| e\.key === ' '/)
  assert.match(page, /isAction\(e\.target\)/)
  assert.match(page, /onOpen=\{q=>setPage\('patients',encounterContext\(q\)\)\}/)
  assert.match(page, /flow\.queueCommand\(entry,name,key,owns\)/)
  assert.match(page, /queueOwner\.current\(ticket\)/)
  assert.match(page, /findPatientConversation\(entry\.patientPublicId,entry\.branchId,entry\.patientCode,owns\)/)
  assert.match(page, /messageOwner\.current\(ticket\)/)
  assert.doesNotMatch(page, /toast\('Patient called\.'\)/)
  assert.match(read('src/b4-queue.css'), /\.queue-open-row:focus-visible/)
  const messages = read('src/pages/ServerMessages.jsx')
  assert.match(messages, /candidate\.patientId === initial\.patientPublicId && candidate\.branchId === initial\.branchId/)
})

test('calendar preview caps avatar badges at three and uses scoped design tokens for selection and focus', () => {
  const calendar = read('src/pages/StaffDayCalendar.jsx')
  const style = read('src/b4-calendar.css')
  assert.match(calendar, /const shown = list\.slice\(0, 3\)/)
  assert.match(calendar, /\+\{list\.length - shown\.length\}/)
  assert.match(style, /\.daycal-cell\.is-selected[^}]*var\(--brand-soft\)/)
  assert.match(style, /\.daycal-daylink:focus-visible[^}]*var\(--focus-ring\)/)
})
