import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: { contents: "export { ArchivesPage } from './src/pages/ArchivesPage.jsx'; export { Table } from './src/components.jsx'; export { setClockSource } from './src/clock.js'", resolveDir: process.env.AUD03_SOURCE_ROOT || process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  plugins: [{ name: 'external-react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }],
})
const { ArchivesPage, Table, setClockSource } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
setClockSource(() => new Date('2026-11-06T02:00:00Z'))
function fixture(status = 'ready', appointments = []) {
  return {
    session: { userId: 'owner', role: 'owner', active: true },
    state: { users: [{ id: 'owner', personId: 'owner', role: 'Owner / Admin', status: 'Active', permissions: ['all'] }], persons: [{ id: 'owner' }], branches: [], dentists: [], appointments, prescriptions: [], invoices: [] },
    appointmentsStatus: status, appointmentFlow: { refresh() { throw Error('SSR must not refresh') } }, actions: {},
  }
}
const render = store => renderToStaticMarkup(React.createElement(ArchivesPage, { store }))
const row = { id: 'synthetic', code: 'SYN-APT', date: '2026-11-05', status: 'Confirmed' }
test('AUD-03: valid empty appointments use the existing table empty contract', () => {
  const html = render(fixture())
  assert.match(html, /No historical appointments are available in this archive view/)
  assert.match(html, /role="status">No historical appointments/)
  assert.doesNotMatch(html, /No records found|could not be refreshed|Loading historical/)
})
test('AUD-03: missing projection is unavailable rather than a valid empty result', () => {
  const store = fixture(); store.state.appointments = undefined
  const html = render(store)
  assert.match(html, /Historical appointments are unavailable in this view/)
  assert.match(html, /Retry historical appointments/)
  assert.doesNotMatch(html, /No records found|No historical appointments are available/)
})
for (const status of ['idle', 'loading']) test('AUD-03: ' + status + ' read does not claim emptiness', () => {
  const html = render(fixture(status))
  assert.match(html, /Loading historical appointments/)
  assert.doesNotMatch(html, /No records found|No historical appointments are available/)
})
test('AUD-03: failed read explains uncertainty and offers the supported retry', () => {
  const html = render(fixture('error'))
  assert.match(html, /role="alert"/)
  assert.match(html, /Historical appointments could not be refreshed/)
  assert.match(html, /This does not mean there are no historical appointments/)
  assert.match(html, /Retry historical appointments/)
  assert.doesNotMatch(html, /No records found|No historical appointments are available/)
})
test('AUD-03: a failed refresh labels previously loaded rows and preserves read-only details', () => {
  const html = render(fixture('error', [row]))
  assert.match(html, /Previously loaded appointments may be out of date/)
  assert.match(html, /SYN-APT/)
  assert.match(html, /caption class="sr-only">Historical appointments/)
  assert.match(html, /View details for SYN-APT/)
  assert.match(html, /disabled[^>]*aria-describedby="archive-restore-unavailable"/)
})
test('AUD-03: retry is not advertised without a supported refresh function', () => {
  const store = fixture('error'); store.appointmentFlow = {}
  const html = render(store)
  assert.match(html, /could not be refreshed/)
  assert.doesNotMatch(html, /Retry historical appointments/)
})
test('AUD-03: unavailable access exposes neither records nor refresh controls', () => {
  const store = fixture('error', [row]); store.session.active = false
  const html = render(store)
  assert.match(html, /Archive access unavailable/)
  assert.doesNotMatch(html, /SYN-APT|Retry historical appointments|Export Archive CSV/)
})
test('AUD-03: shared Table keeps default, custom empty and populated semantics', () => {
  const renderTable = props => renderToStaticMarkup(React.createElement(Table, { columns: [{ key: 'id', label: 'Reference' }], ...props }))
  assert.match(renderTable({ rows: [] }), /No records found/)
  assert.match(renderTable({ rows: [], empty: 'Synthetic empty message' }), /Synthetic empty message/)
  const html = renderTable({ rows: [{ id: 'synthetic' }], caption: 'Synthetic records' })
  assert.match(html, /<caption class="sr-only">Synthetic records/)
  assert.match(html, /scope="col"/)
  assert.match(html, /synthetic/)
})
