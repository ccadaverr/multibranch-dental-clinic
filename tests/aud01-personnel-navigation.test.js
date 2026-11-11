import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NAV } from '../src/data.js'
import { canAccessPage } from '../src/safeguards.js'
import { personnelFixture } from './support/aud01-personnel.js'

const require = createRequire(import.meta.url)
const bundle = await build({
  stdin:{contents:"export { Shell } from './src/layout.jsx'", resolveDir:process.cwd()},
  bundle:true, write:false, platform:'node', format:'esm', loader:{'.css':'empty'},
  plugins:[{name:'shared-react', setup(b) { b.onResolve({filter:/^react$/}, () => ({path:pathToFileURL(require.resolve('react')).href, external:true})) }}],
})
const { Shell } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
function shell(role, page = 'dashboard', transform = () => {}) {
  const store = personnelFixture(role)
  transform(store)
  return renderToStaticMarkup(React.createElement(Shell, {role, page, store, activeBranch:'All Branches', setActiveBranch(){}, setPage(){}, onLogout(){}}, 'Synthetic content'))
}

test('AUD-01: Owner discovers personnel next to Work Schedules in Clinic Operations', () => {
  assert.deepEqual(NAV.owner.filter(([key]) => key === 'team'), [['team','Dentist & Staff']])
  const html = shell('owner', 'team')
  const operations = html.split('nav-group-label">Clinic Operations</span>')[1]?.split('<div class="nav-group">')[0] || ''
  assert.match(operations, /aria-current="page"[^>]*>[\s\S]*?<span>Dentist &amp; Staff<\/span>/)
  assert.match(operations, /Dentist &amp; Staff[\s\S]*Work Schedules/)
  for (const label of ['Executive Dashboard', 'Branches', 'User Management', 'Archives &amp; Records']) assert.ok(html.includes(label), label)
})

test('AUD-01: personnel route and rendered menu remain Owner-only', () => {
  for (const role of ['patient','staff','dentist','owner']) {
    const {state, session} = personnelFixture(role)
    assert.equal(canAccessPage(state, session, 'team'), role === 'owner', `${role} direct page guard`)
    assert.equal(shell(role).includes('<span>Dentist &amp; Staff</span>'), role === 'owner', `${role} menu`)
    assert.equal(canAccessPage(state, session, 'dashboard'), true)
    if (role !== 'owner') assert.equal(NAV[role].some(([key]) => key === 'team'), false)
  }
  assert.match(shell('staff'), /Appointments[\s\S]*Check-In[\s\S]*Billing &amp; Payments/)
  assert.match(shell('dentist'), /My Schedule[\s\S]*My Queue[\s\S]*Treatment/)
})

test('AUD-01: revoked or forged Owner session cannot reveal the personnel entry', () => {
  for (const transform of [
    store => { store.session.active = false },
    store => { store.state.users.find(u => u.id === store.session.userId).status = 'Inactive'; store.state.users.find(u => u.id === store.session.userId).accountStatus = 'Inactive' },
    store => { store.state.users.find(u => u.id === store.session.userId).permissions = [] },
  ]) assert.equal(shell('owner', 'team', transform).includes('<span>Dentist &amp; Staff</span>'), false)
})
