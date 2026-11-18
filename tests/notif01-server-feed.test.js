import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)
const bundle = await build({ entryPoints: ['src/layout.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const { serverNotificationSnapshot, serverNotificationDestination, notificationFeedKey, NotificationPanel } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const session = { serverUserId: 'server-a', userId: 'u1', role: 'staff', active: true, branchId: 'b1' }
const state = { persons: [{ id: 'person1' }], users: [{ id: 'u1', personId: 'person1', role: 'Staff', status: 'Active', branchId: 'b1', permissions: ['all'] }], staff: [{ userId: 'u1', personId: 'person1', branchId: 'b1' }], notifications: [] }

test('NOTIF-01 maps server dates and preserves total unread beyond the recent window', () => {
  const result = serverNotificationSnapshot({ ok: true, data: [{ id: 'n1', title: 'Test', body: null, read: false, created_at: '2026-11-06T08:00:00+08:00' }], meta: { unread: 70 } })
  assert.equal(result.unread, 70)
  assert.equal(result.items[0].createdAt, '2026-11-06T08:00:00+08:00')
  assert.equal(result.items[0].channel, 'In-app')
  assert.deepEqual(serverNotificationSnapshot({ ok: true, data: [], meta: { unread: 0 } }).items, [])
  for (const response of [{ ok: false }, { ok: true, data: [] }, { ok: true, data: null, meta: { unread: 0 } }, { ok: true, data: [], meta: { unread: -1 } }]) assert.throws(() => serverNotificationSnapshot(response))
})

test('NOTIF-01 safe navigation drops ambiguous IDs and rejects unknown or forbidden targets', () => {
  assert.deepEqual(serverNotificationDestination(state, session, { target: { page: 'handovers', id: 'ambiguous' } }), { page: 'handovers', context: null })
  for (const page of ['visits', 'billing', 'messages', 'book', 'handovers', 'leave']) {
    const destination = serverNotificationDestination(state, session, { target: { page, id: 'not-a-legacy-id' } })
    if (destination) assert.equal(destination.context, null)
  }
  for (const page of ['https://example.com', 'constructor', 'unknown', 'users']) assert.equal(serverNotificationDestination(state, session, { target: { page } }), null)
  const denied = { ...state, users: state.users.map(u => ({ ...u, permissions: [] })) }
  assert.equal(serverNotificationDestination(denied, session, { target: { page: 'billing' } }), null)
  assert.equal(serverNotificationDestination(state, { ...session, active: false }, { target: { page: 'handovers' } }), null)
})

test('NOTIF-01 session keys distinguish accounts, mode and permission validity flags', () => {
  for (const changed of [{ serverUserId: 'server-b' }, { userId: 'u2' }, { active: false }, { role: 'owner' }, { serverUserId: null }]) assert.notEqual(notificationFeedKey(session), notificationFeedKey({ ...session, ...changed }))
})

test('NOTIF-01 server initial rendering shows loading, never local-demo content or a successful empty feed', () => {
  const html = renderToStaticMarkup(React.createElement(NotificationPanel, { role: 'staff', store: { state: { ...state, notifications: [{ id: 'demo-secret', title: 'LOCAL DEMO TITLE', recipientUserId: 'u1', branchId: 'b1' }] }, session, actions: {}, toast() {} }, onClose() {}, setPage() {} }))
  assert.match(html, /Loading notifications/)
  assert.doesNotMatch(html, /LOCAL DEMO TITLE|No recent notifications\./)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /50 records at a time/)
})

test('notification history accepts only a cursor matching the last returned row', () => {
  const page = { ok: true, data: [{ id: 'n1', title: 'Synthetic', read: true }], meta: { unread: 0, has_more: true, next_before: 'n1' } }
  assert.equal(serverNotificationSnapshot(page).nextBefore, 'n1')
  assert.equal(serverNotificationSnapshot({ ...page, meta: { unread: 0, has_more: false, next_before: null } }).nextBefore, null)
  for (const meta of [{ unread: 0, has_more: true, next_before: 'other' }, { unread: 0, has_more: false, next_before: 'n1' }, { unread: 0, has_more: 'yes' }]) assert.throws(() => serverNotificationSnapshot({ ...page, meta }))
})

test('archived notifications retain unread history separately from the active inbox total', () => {
  const row = { id: 'archived-1', title: 'Synthetic archive', read: false, archived: true, archived_at: '2026-11-15T12:00:00+08:00' }
  const result = { ok: true, data: [row], meta: { unread: 0, collection: 'archived', archive_available: true, has_more: false, next_before: null } }
  const parsed = serverNotificationSnapshot(result)
  assert.equal(parsed.items[0].read, false)
  assert.equal(parsed.items[0].archived, true)
  assert.equal(parsed.archiveAvailable, true)
  assert.equal(parsed.unread, 0)
  assert.throws(() => serverNotificationSnapshot({ ...result, meta: { ...result.meta, collection: 'active' } }))
  assert.throws(() => serverNotificationSnapshot({ ...result, data: [{ ...row, archived_at: 'invalid' }] }))
  assert.throws(() => serverNotificationSnapshot({ ...result, data: [{ ...row, archived: false }] }))
})

test('NOTIF-01 source guards retain race invalidation and awaited authoritative reads', () => {
  const source = readFileSync('src/layout.jsx', 'utf8')
  assert.match(source, /epoch.current !== token \|\| generation.current !== requestId/)
  assert.match(source, /generation.current \+= 1/)
  assert.match(source, /readNotification\(id, guard, collection\)/)
  assert.match(source, /run\(readAllNotifications, true, '\*'\)/)
  assert.match(source, /!await mark\(n.id\)/)
  assert.match(source, /latest.current.key!==key/)
})
