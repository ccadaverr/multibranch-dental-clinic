import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../src/api-client.js'
import { loadMessages } from '../src/messaging-api.js'

test('old-message search sends a literal encoded query and retains the server cursor contract', async () => {
  globalThis.document = { cookie: 'XSRF-TOKEN=abc' }
  api.__resetCsrfCacheForTests()
  let called
  globalThis.fetch = async url => {
    called = new URL(url, 'http://localhost')
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'old', body: '<img> 100%_needle', mine:false, sender: { name: 'Patient', role: 'Patient' }, sent_at: '2026-10-29T10:00:00+08:00' }], meta: { next_cursor: 'older-match' } }) }
  }
  const result = await loadMessages('conversation', 'cursor', ' 100%_needle ')
  assert.equal(called.pathname, '/api/conversations/conversation/messages')
  assert.equal(called.searchParams.get('q'), '100%_needle')
  assert.equal(called.searchParams.get('cursor'), 'cursor')
  assert.equal(result.nextCursor, 'older-match')
  assert.equal(result.rows[0].body, '<img> 100%_needle')
})

test('empty matching history stays an empty result and errors are never reported as no matches', async () => {
  globalThis.document = { cookie: 'XSRF-TOKEN=abc' }
  api.__resetCsrfCacheForTests()
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [], meta: { next_cursor: null } }) })
  assert.deepEqual(await loadMessages('c', null, 'absent'), { ok: true, rows: [], nextCursor: null })
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) })
  assert.equal((await loadMessages('c', null, 'needle')).ok, false)
})
