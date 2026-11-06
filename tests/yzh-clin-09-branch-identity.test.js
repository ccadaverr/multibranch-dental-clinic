// CLIN-09: authored for deferred execution with node --test.
// Dependency-free controller tests execute ToothTimeline's actual pre-JSX code
// with isolated hook cells. They do not render React, exercise DOM selection,
// authenticate requests or prove backend authorization. Existing CLIN-03/04
// browser suites remain required for selection, focus and Front/Top acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const source = readFileSync(new URL('../src/components/odontogram/ToothTimeline.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const start = source.indexOf('export function ToothTimeline(')
const render = source.indexOf('\n  return (', start)
assert.ok(start >= 0 && render > start, 'Review the controller extraction if the component structure changes.')
const controller = source.slice(start, render).replace('export function', 'function')
  + '\n  return {save: handleSave, change: changeForm, form};\n}\nToothTimeline'
const wire = value => JSON.parse(JSON.stringify(value))
const branches = [{id: 'b1', name: 'Synthetic Central'}, {id: 'b2', name: 'Synthetic North'}]
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return {promise, resolve, reject}
}

function editor(options = {}) {
  const state = [], cleanups = [], calls = [], dirty = [], coercions = []
  // Fail if production code attempts Number(publicReference), even if a test's
  // chosen reference happens to resemble an integer.
  const noCoercion = value => { coercions.push(value); throw new Error('Do not coerce branch references.') }
  noCoercion.isSafeInteger = Number.isSafeInteger
  const component = runInNewContext(controller, {
    Number: noCoercion,
    today: () => '2026-11-06', toothLabel: tooth => tooth, getToothFullName: tooth => tooth,
    useState(value) {
      const index = state.length
      state.push(value)
      return [value, next => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef: value => ({current: value}),
    useEffect(effect) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
  }, {filename: 'ToothTimeline.clin09-controller.js'})
  const {respond = async () => ({ok: true}), patientId = 'patient-A', ...props} = options
  const instance = component({
    tooth: '18', data: {settings: {statuses: ['Caries']}, current: [], history: []},
    branches, activeBranchId: 'b1', canRecord: true,
    ...props,
    onDirtyChange: value => dirty.push(value),
    onRecord(payload, ownsEditor) {
      // Models ChartView's captured patient callback; no patient ID is inferred
      // from a name or inserted into ToothTimeline's payload.
      const call = {patientId, body: wire(payload), payload, ownsEditor}
      calls.push(call)
      return respond(call)
    },
  })
  return {
    ...instance, state, calls, dirty, coercions,
    submit: () => instance.save({preventDefault() {}}),
    snapshot: () => wire(state),
    unmount: () => { for (const cleanup of cleanups.splice(0)) cleanup() },
  }
}

for (const ref of ['b1', 'b2']) {
  test(`serializes ${ref} as the exact branch_ref, without a numeric branch_id`, async () => {
    const e = editor({activeBranchId: ref})
    await e.submit()
    assert.equal(e.calls[0].body.branch_ref, ref)
    assert.equal(Object.hasOwn(e.calls[0].body, 'branch_id'), false)
    assert.deepEqual(e.coercions, [])
  })
}

test('numeric-looking legacy refs remain strings with their original representation', async () => {
  for (const ref of ['001', '12', '0', '9007199254740993']) {
    const e = editor({branches: [{id: ref, name: 'Synthetic branch'}], activeBranchId: ref})
    await e.submit()
    assert.equal(e.calls[0].body.branch_ref, ref)
    assert.equal(Object.hasOwn(e.calls[0].body, 'branch_id'), false)
    assert.deepEqual(e.coercions, [])
  }
})

test('multi-branch selection records the non-default branch without substitution', async () => {
  const e = editor()
  e.change({branch_id: 'b2', note: 'Synthetic finding'})
  await e.submit()
  assert.equal(e.calls[0].body.branch_ref, 'b2')
  assert.equal(e.calls[0].body.note, 'Synthetic finding')
})

test('single-branch default uses the sole reference and preserves it after success', async () => {
  const e = editor({branches: [branches[1]], activeBranchId: null})
  e.change({note: 'Synthetic note', surfaces: ['M']})
  await e.submit()
  assert.equal(e.calls[0].body.branch_ref, 'b2')
  assert.equal(e.form.current.branch_id, 'b2')
  assert.equal(e.form.current.note, '')
  assert.deepEqual(wire(e.form.current.surfaces), [])
  assert.equal(e.dirty.at(-1), false)
})

test('empty selection omits branch keys and never substitutes the first branch', async () => {
  for (const available of [branches, []]) {
    const e = editor({branches: available, activeBranchId: null})
    await e.submit()
    assert.equal(Object.hasOwn(e.calls[0].body, 'branch_ref'), false)
    assert.equal(Object.hasOwn(e.calls[0].body, 'branch_id'), false)
  }
  // Existing server inference/explicit-selection validation remains authoritative.
})

test('unavailable explicit reference is sent unchanged; server rejection retains the draft', async () => {
  const message = 'You are not assigned to the specified branch.'
  const e = editor({activeBranchId: 'removed-branch', respond: async () => ({ok: false, message})})
  e.change({note: 'Synthetic retained note', surfaces: ['D']})
  await e.submit()
  assert.equal(e.calls[0].body.branch_ref, 'removed-branch')
  assert.equal(e.form.current.branch_id, 'removed-branch')
  assert.equal(e.form.current.note, 'Synthetic retained note')
  assert.deepEqual(wire(e.form.current.surfaces), ['D'])
  assert.equal(e.state[2], message)
  assert.equal(e.state[1], false)
  assert.equal(e.dirty.at(-1), true)
})

test('typed internal numeric IDs retain branch_id after a DOM-style string selection', async () => {
  const e = editor({branches: [{id: 1, name: 'Synthetic Central'}, {id: 2, name: 'Synthetic North'}], activeBranchId: 1})
  e.change({branch_id: '2'})
  await e.submit()
  assert.equal(e.calls[0].body.branch_id, 2)
  assert.equal(Object.hasOwn(e.calls[0].body, 'branch_ref'), false)
  assert.deepEqual(e.coercions, [])
})

test('a typed numeric active ID is preserved without guessing a numeric type for strings', async () => {
  const e = editor({branches: [], activeBranchId: 7})
  await e.submit()
  assert.equal(e.calls[0].body.branch_id, 7)
  assert.equal(Object.hasOwn(e.calls[0].body, 'branch_ref'), false)
})

test('invalid numeric IDs cannot serialize as null or become fabricated legacy references', async () => {
  for (const id of [Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const e = editor({branches: [{id, name: 'Invalid fixture branch'}], activeBranchId: id})
    await e.submit()
    assert.equal(e.calls.length, 0)
    assert.equal(e.state[2], 'Choose a valid clinic branch.')
    assert.equal(e.state[1], false)
  }
})

test('pending save retains its submitted branch, tooth and cloned surfaces while newer edits survive', async () => {
  const gate = deferred()
  const e = editor({respond: () => gate.promise})
  const surfaces = ['M']
  e.change({branch_id: 'b2', note: 'Synthetic submitted note', surfaces})
  const pending = e.submit()
  surfaces.push('D')
  e.change({branch_id: 'b1', note: 'Synthetic newer note', surfaces: ['L']})
  gate.resolve({ok: true})
  await pending
  assert.equal(e.calls[0].body.branch_ref, 'b2')
  assert.equal(e.calls[0].body.tooth, '18')
  assert.deepEqual(e.calls[0].body.surfaces, ['M'])
  assert.deepEqual(wire(e.calls[0].payload.surfaces), ['M'])
  assert.equal(e.form.current.branch_id, 'b1')
  assert.equal(e.form.current.note, 'Synthetic newer note')
  assert.deepEqual(wire(e.form.current.surfaces), ['L'])
  assert.equal(e.dirty.at(-1), true)
  assert.equal(e.state[1], false)
})

test('same-tick duplicate saves and a chart-wide pending save do not send another command', async () => {
  const gate = deferred()
  const e = editor({respond: () => gate.promise})
  const pending = e.submit()
  await e.submit()
  assert.equal(e.calls.length, 1)
  assert.equal(e.state[1], true)
  gate.resolve({ok: true})
  await pending
  const blocked = editor({recordingPending: true})
  await blocked.submit()
  assert.equal(blocked.calls.length, 0)
})

test('A to B to A editor generations keep distinct branch drafts and suppress the old completion', async () => {
  const gate = deferred()
  let generation = 1
  const a1 = editor({tooth: '18', isCurrent: () => generation === 1, respond: () => gate.promise})
  a1.change({branch_id: 'b2', note: 'Synthetic old A note'})
  const pending = a1.submit()
  generation = 2
  const b = editor({tooth: '17', isCurrent: () => generation === 2})
  b.change({branch_id: 'b2', note: 'Synthetic B draft'})
  generation = 3
  const a2 = editor({tooth: '18', isCurrent: () => generation === 3})
  a2.change({branch_id: 'b1', note: 'Synthetic fresh A draft'})
  const bBefore = b.snapshot(), aBefore = a2.snapshot(), dirtyCount = a1.dirty.length
  gate.resolve({ok: true})
  await pending
  assert.deepEqual(b.snapshot(), bBefore)
  assert.deepEqual(a2.snapshot(), aBefore)
  assert.equal(a1.dirty.length, dirtyCount)
  assert.equal(a1.calls[0].ownsEditor(), false)
  assert.equal(a1.calls[0].body.branch_ref, 'b2')
  assert.equal(a2.form.current.branch_id, 'b1')
  await a2.submit()
  assert.equal(a2.calls[0].body.branch_ref, 'b1')
  assert.equal(a2.calls[0].body.tooth, '18')
})

test('unmounted patient A completion cannot adopt patient B or its tooth draft', async () => {
  const gate = deferred()
  const a = editor({patientId: 'patient-A', tooth: '18', respond: () => gate.promise})
  a.change({branch_id: 'b2', note: 'Synthetic A note'})
  const pending = a.submit()
  a.unmount()
  const b = editor({patientId: 'patient-B', tooth: '17'})
  b.change({branch_id: 'b1', note: 'Synthetic B note'})
  const before = b.snapshot(), dirtyCount = a.dirty.length
  gate.resolve({ok: true})
  await pending
  assert.deepEqual(b.snapshot(), before)
  assert.equal(a.dirty.length, dirtyCount)
  assert.equal(a.calls[0].ownsEditor(), false)
  assert.equal(a.calls[0].patientId, 'patient-A')
  assert.equal(a.calls[0].body.tooth, '18')
  await b.submit()
  assert.equal(b.calls[0].patientId, 'patient-B')
  assert.equal(b.calls[0].body.tooth, '17')
})

test('validation failure and unexpected rejection release the latch and retain the exact retry branch', async () => {
  let attempt = 0
  const e = editor({respond: async () => {
    attempt++
    if (attempt === 1) return {ok: false, message: 'Please select a branch.'}
    if (attempt === 2) throw new Error('Synthetic transport failure')
    return {ok: true}
  }})
  e.change({branch_id: 'b2', note: 'Synthetic retry note'})
  await e.submit()
  assert.equal(e.state[2], 'Please select a branch.')
  await e.submit()
  assert.match(e.state[2], /Check the chart before retrying/)
  assert.equal(e.state[1], false)
  assert.equal(e.form.current.note, 'Synthetic retry note')
  await e.submit()
  assert.deepEqual(e.calls.map(call => call.body.branch_ref), ['b2', 'b2', 'b2'])
  assert.deepEqual(e.coercions, [])
})

test('read-only editor cannot record a finding', async () => {
  const e = editor({canRecord: false})
  await e.submit()
  assert.equal(e.calls.length, 0)
})
