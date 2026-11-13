import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { workSchedules } from '../src/api-client.js'

const bundle = await build({ stdin: { contents: "export { StaffOnDuty } from './src/pages/StaffOnDuty.jsx'", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm', external: ['react', 'react-dom'], loader: { '.css': 'empty' } })
const dir = new URL('../node_modules/.cache/', import.meta.url)
mkdirSync(dir, { recursive: true })
const file = new URL('stf07-duty-test-bundle.mjs', dir)
writeFileSync(file, bundle.outputFiles[0].text)
const { StaffOnDuty } = await import(file.href)

test('Staff on-duty panel does not fabricate status without a clinic session', () => {
  const html = renderToString(React.createElement(StaffOnDuty, { session: null, activeBranch: 'All Branches' }))
  assert.match(html, /Sign in to the clinic server to verify/)
  assert.doesNotMatch(html, /On duty today|Off duty/)
})

test('Staff on-duty panel waits for server evidence before showing a status', () => {
  const html = renderToString(React.createElement(StaffOnDuty, { session: { serverUserId: 'fictional-staff' }, activeBranch: 'All Branches' }))
  assert.match(html, /Checking today’s duty status/)
  assert.match(html, /aria-label="Refresh duty status"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /disabled=""/)
  assert.doesNotMatch(html, />Refresh status</)
  assert.doesNotMatch(html, /class="fd-badge/)
})

test('work-schedule client keeps the read-only duty projection and explicit forbidden failure', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { duty: { date: '2026-10-29', rows: [{ dentist_id: 'd1', branch_id: 'b1', on_duty_today: false }] } } }) })
  const result = await workSchedules()
  assert.deepEqual(result.data.duty.rows, [{ dentist_id: 'd1', branch_id: 'b1', on_duty_today: false }])
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) })
  assert.equal((await workSchedules()).kind, 'forbidden')
})
