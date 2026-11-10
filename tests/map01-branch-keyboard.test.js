import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Deferred MAP-01 coverage: pure validation and SSR/source contracts, not browser acceptance.
const require = createRequire(import.meta.url)
const bundle = await build({
  entryPoints: ['src/pages/Admin.jsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }))
  } }],
})
const { branchPinError, BranchesPage } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

test('MAP-01 coordinate bounds match the branch contract and require a complete pair', () => {
  for (const pair of [[null, null], ['', ''], [undefined, undefined], [4, 114], [22, 128], ['14.800254', '120.9233274']]) {
    assert.equal(branchPinError(...pair), '', `valid pair: ${pair}`)
  }
  for (const pair of [[null, 114], [4, ''], [3.999, 114], [22.001, 128], [4, 113.999], [22, 128.001], [NaN, 114], [4, Infinity], ['invalid', 114]]) {
    assert.ok(branchPinError(...pair), `reject invalid pair: ${pair}`)
  }
})

test('MAP-01 renders named native keyboard controls and honest draft instructions without a default saved pin', () => {
  const html = renderToStaticMarkup(React.createElement(BranchesPage, { store: {
    session: {serverUserId:'synthetic-owner',userId:'owner',role:'owner',active:true},
    state: { branches: [{ id: 'map01-test', name: 'Synthetic branch', branchCode: 'BRC-A', latitude: null, longitude: null }], services: [], branchServices: [],
      persons:[{id:'owner-person'}],users:[{id:'owner',personId:'owner-person',role:'Owner / Admin',status:'Active',permissions:['all']}],staff:[] },
    actions: {}, toast() {},
  } }))
  assert.match(html, /Draft latitude/)
  assert.match(html, /Draft longitude/)
  assert.match(html, /type="number" min="4" max="22" step="any"/)
  assert.match(html, /type="number" min="114" max="128" step="any"/)
  assert.match(html, /Tab moves between controls/)
  assert.match(html, /edits are saved only with Publish Branch Changes/)
  assert.match(html, /Reset location to saved coordinates/)
  assert.match(html, /This branch has no saved location/)
  assert.match(html, /id="branch-coordinate-status" role="status"/)
})

test('MAP-01 source guard retains authoritative publish and map synchronization', () => {
  const source = readFileSync('src/pages/Admin.jsx', 'utf8')
  assert.match(source, /if \(coordinateError\) return toast\(coordinateError, 'warning'\)/)
  assert.match(source, /const id=selected/)
  assert.match(source, /await syncBranchUpdate\(id,form\)/)
  assert.match(source, /if\(!result.ok\).*setSaveError\(message\);toast\(message,'warning'\);return/)
  assert.match(source, /actions.adoptBranchFromServer\(id,result.record\)/)
  assert.match(source, /if\(!owner.current\(ticket\)\)return/)
  assert.match(source, /if\(result.record\?\.id!==id\)/)
  assert.match(source, /if \(!branchPinError\(latitude, longitude\)\) mapControl.current\?\.setCoordinates/)
  assert.match(source, /coordinateInputRef.current\?\.focus\(\)/)
  assert.match(source, /React.useEffect\(\(\)=>setForm\(branch\|\|\{\}\),\[branch\]\)/)
})
