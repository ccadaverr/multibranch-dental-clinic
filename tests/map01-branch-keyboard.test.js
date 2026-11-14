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
  // Inspect the call shape without fixing its arity to the old, unguarded implementation.
  const { parse } = require('@babel/parser')
  let publish
  const visit = (node, parent) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee.name === 'syncBranchUpdate') publish = { node, parent }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, node))
      else if (value && typeof value === 'object') visit(value, node)
    }
  }
  visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }))
  assert.equal(publish.parent.type, 'AwaitExpression')
  assert.deepEqual(publish.node.arguments.slice(0, 2).map(arg => arg.name), ['id', 'form'])
  const callback = publish.node.arguments[2]
  assert.equal(callback.type, 'ArrowFunctionExpression')
  const guard = new Function('owner', 'ticket', 'selectedRef', 'id', 'canAccessPage', 'state', 'store',
    'return (' + source.slice(callback.start, callback.end) + ')')
  for (const [current, selected, allowed, expected] of [[true,'b1',true,true],[false,'b1',true,false],[true,'b2',true,false],[true,'b1',false,false]]) {
    const ticket = {}, state = {}, store = { session: {} }
    const beforeDispatch = guard({ current: value => { assert.equal(value, ticket); return current } }, ticket, { current: selected }, 'b1',
      (actualState, session, page) => { assert.equal(actualState, state); assert.equal(session, store.session); assert.equal(page, 'branches'); return allowed }, state, store)
    assert.equal(beforeDispatch(), expected)
  }
  assert.match(source, /if\(!result.ok\).*setSaveError\(message\);toast\(message,'warning'\);return/)
  assert.match(source, /actions.adoptBranchFromServer\(id,result.record\)/)
  assert.match(source, /if\(!owner.current\(ticket\)\)return/)
  assert.match(source, /if\(result.record\?\.id!==id\)/)
  assert.match(source, /if \(!branchPinError\(latitude, longitude\)\) mapControl.current\?\.setCoordinates/)
  assert.match(source, /coordinateInputRef.current\?\.focus\(\)/)
  assert.match(source, /React.useEffect\(\(\)=>setForm\(branch\|\|\{\}\),\[branch\]\)/)
})
