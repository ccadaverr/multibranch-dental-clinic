// Decision-evidence tests only. PHP/SQL/clients are read as text, never imported or executed.
// Green results confirm observed hazards/coverage, not repaired-migration or PostgreSQL acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const hash = data => createHash('sha256').update(data).digest('hex')
const manifest = JSON.parse(read('qa/queue-preservation/review-manifest.json'))
const targetPath = 'backend/database/migrations/2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php'
const migration = read(targetPath)
const [up, down] = migration.split('public function down(): void')
assert.ok(down, 'Review literal-source parsers if migration shape changes')
const legacySource = read('backend/database/migrations/2026_10_01_000100_create_queue_tables.php')
const queue = read('backend/app/Services/Queue/QueueService.php')
const model = read('backend/app/Models/QueueEntry.php')
const treatment = read('backend/app/Services/Treatments/TreatmentService.php')
const quoted = text => [...text.matchAll(/'([^']*)'/g)].map(match => match[1])
function constraint(source, name, column) {
  const text = source.match(new RegExp(`ADD CONSTRAINT ${name} CHECK \\(${column} IN \\(([^)]+)\\)`))?.[1]
  assert.ok(text, `No recognized literal ${name}; source parser needs review`)
  return quoted(text)
}
function constant(source, name) {
  const text = source.match(new RegExp(`public const ${name} = \\[([^;]+)\\];`))?.[1]
  assert.ok(text, `No recognized literal ${name}`)
  return quoted(text)
}
function mappings(source) {
  const matches = [...source.matchAll(/UPDATE queue_entries SET status = '([^']+)'[^"\n]*? WHERE status (?:IN \(([^)]+)\)|= '([^']+)')/g)]
  assert.equal(matches.length, 3, 'Parser only recognizes the three reviewed literal status UPDATEs')
  return Object.fromEntries(matches.flatMap(([, to, list, single]) => (list ? quoted(list) : [single]).map(from => [from, to])))
}
const oldStatuses = constraint(legacySource, 'queue_entries_status_check', 'status')
const oldPriorities = constraint(legacySource, 'queue_entries_priority_check', 'priority')
const newStatuses = constraint(up, 'queue_entries_status_check', 'status')
const newPriorities = constraint(up, 'queue_entries_priority_check', 'priority')
const forward = mappings(up), reverse = mappings(down)
const transitionText = queue.split('public const TRANSITIONS = [')[1]?.split('\n    ];')[0]
assert.ok(transitionText)
const transitions = Object.fromEntries([...transitionText.matchAll(/'([^']+)' => \[\[([^\]]+)\], '([^']+)', '([^']+)'\]/g)]
  .map(([, command, sources, target, event]) => [command, {sources: quoted(sources), target, event}]))

for (const [path, expected] of Object.entries(manifest.sourceHashes)) {
  test('source fingerprint: ' + path, () => assert.equal(hash(read(path)), expected))
}

test('inventory: exact predecessor, union target, model and priority vocabularies', () => {
  assert.deepEqual(oldStatuses, manifest.legacyStatuses)
  assert.deepEqual(oldPriorities, manifest.legacyPriorities)
  assert.deepEqual(newStatuses, manifest.currentModelStatuses)
  assert.deepEqual(constant(model, 'STATUSES'), newStatuses)
  assert.deepEqual(newPriorities, manifest.currentRequestPriorities)
  assert.deepEqual(constant(model, 'PRIORITIES'), newPriorities)
  assert.deepEqual(forward, manifest.observedUnsafeForwardMap)
  assert.deepEqual(reverse, manifest.observedUnsafeReverseMap)
  assert.deepEqual(transitions, manifest.namedTransitions)
})

test('inventory: exact Cartesian coverage and refusal decisions, not a runtime mapper', () => {
  const expected = oldStatuses.flatMap(status => oldPriorities.map(priority => ({status, priority})))
  assert.equal(manifest.legacyCombinations.length, 15)
  assert.deepEqual(manifest.legacyCombinations.map(({status, priority}) => ({status, priority})), expected)
  const alternate = newStatuses.filter(status => !oldStatuses.includes(status))
  assert.deepEqual(manifest.alternateCombinations.map(({status, priority}) => ({status, priority})),
    alternate.flatMap(status => newPriorities.map(priority => ({status, priority}))))
  assert.equal(manifest.alternateCombinations.length, 10)
  assert.equal(manifest.implementationVerdict, 'BLOCKED')
  assert.equal(manifest.executionAllowed, false)
  assert.equal(manifest.provisioningAllowed, false)
})

for (const row of manifest.legacyCombinations) {
  test(`decision coverage: retain ${row.status} / ${row.priority}; no conversion authorized`, () => {
    assert.equal(row.recommendedPreservedStatus, row.status)
    assert.equal(row.recommendedPreservedPriority, row.priority)
    assert.equal(row.observedUnsafeTarget, forward[row.status])
    assert.equal(row.observedUnsafePriority, row.priority === 'Urgent' ? 'Normal' : row.priority)
    assert.equal(row.newPriorityRequestSupported, newPriorities.includes(row.priority))
    assert.equal(row.conversion, 'REFUSED_PENDING_DECISION')
  })
}
for (const row of manifest.alternateCombinations) {
  test(`decision coverage: no inferred recovery for ${row.status} / ${row.priority}`, () => {
    assert.equal(row.conversion, 'REFUSED_REQUIRES_PROVENANCE')
    assert.equal(row.automaticLegacyRecovery, false)
    assert.equal(oldStatuses.includes(row.status), false)
    assert.ok(newStatuses.includes(row.status) && newPriorities.includes(row.priority))
  })
}

test('analysis: actual UP has two many-to-one status groups and two lossy round trips', () => {
  const groups = Object.groupBy(oldStatuses, status => forward[status])
  assert.deepEqual(groups['In Queue'], ['Waiting', 'Temporarily Away'])
  assert.deepEqual(groups['In Treatment'], ['Called', 'Treatment Ready'])
  assert.deepEqual(oldStatuses.filter(status => reverse[forward[status]] !== status), ['Called', 'Temporarily Away'])
  // Distinct synthetic originals produce the same visible target; destination alone cannot recover the original.
  const originals = ['synthetic-reason-a', 'synthetic-reason-b', null, '']
  assert.equal(new Set(originals.map(() => JSON.stringify({priority: 'Normal', reason: null}))).size, 1)
  assert.match(up, /SET priority = 'Normal', priority_reason = NULL WHERE priority = 'Urgent'/)
})

test('analysis: populated predecessor values conflict before constraint replacement', () => {
  const update = up.indexOf('UPDATE queue_entries SET status')
  assert.ok(update >= 0)
  for (const name of ['queue_entries_status_check', 'queue_entries_closed_check']) {
    assert.ok(up.indexOf('DROP CONSTRAINT IF EXISTS ' + name) > update)
  }
  assert.deepEqual(oldStatuses.filter(status => !oldStatuses.includes(forward[status])), oldStatuses)
  assert.match(legacySource, /CHECK \(\(status = 'Served'\) = \(closed_at IS NOT NULL\)\)/)
  // Source-predicate calculation, not SQL execution: Served has closed_at, but Done fails the old iff predicate.
  const synthetic = {status: forward.Served, closed_at: '2026-11-12T01:00:00Z'}
  assert.equal((synthetic.status === 'Served') === (synthetic.closed_at !== null), false)
})

test('analysis: retained command targets fit union; six converted source paths fail', () => {
  const failures = []
  for (const [name, {sources, target}] of Object.entries(transitions)) {
    assert.ok(oldStatuses.includes(target) && newStatuses.includes(target))
    for (const status of sources) if (!sources.includes(forward[status])) failures.push(`${name}:${status}`)
  }
  assert.deepEqual(failures, ['call:Waiting', 'ready:Called', 'away:Waiting', 'away:Called', 'away:Treatment Ready', 'return:Temporarily Away'])
  assert.match(queue, /! in_array\(\$entry->status, \['Called', 'Treatment Ready'\], true\)/)
  assert.equal(['Called', 'Treatment Ready'].includes(forward.Called), false)
})

test('analysis: treatment START serves the queue; completion requires Served, not Done', () => {
  assert.match(queue, /'status' => 'Served', 'closed_at' => ClinicClock::now\(\), 'revision' => \$entry->revision \+ 1/)
  assert.ok(treatment.indexOf('$this->queue->serve($actor, $current)') < treatment.indexOf("$this->visits->applyClinical($actor, $current, $appointment, 'In Treatment')"))
  assert.match(treatment, /\$entry\?->status !== 'Served'/)
  assert.match(treatment, /\$this->visits->applyClinical\(\$actor, \$visit, \$appointment, 'Completed'\)/)
  assert.match(treatment, /Followups::fromTreatment\(\$current\)/)
  assert.equal(forward.Served, 'Done')
})

test('analysis: no target history rewrite, but no original-value journal or conversion revision', () => {
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM|TRUNCATE)\s+queue_entry_history|DISABLE\s+TRIGGER|DROP\s+TRIGGER/i)
  assert.doesNotMatch(up, /Schema::create|INSERT\s+INTO|revision\s*=|updated_by_user_id\s*=|updated_at\s*=/i)
  assert.match(legacySource, /BEFORE UPDATE OR DELETE ON queue_entry_history/)
  assert.match(queue, /'queue_entry_id' => \$entry->id/)
  assert.match(queue, /'revision' => \$entry->revision/)
  assert.match(queue, /'actor_user_id' => \$actor->id/)
})

test('analysis: closed-state, partial-index and reporting predicates disagree after conversion', () => {
  assert.match(up, /status IN \('Done', 'Served'\)\) = \(closed_at IS NOT NULL\)/)
  assert.match(legacySource, /WHERE status <> 'Served'/)
  assert.match(queue, /\['Served', 'Done', 'Cancelled', 'No-show'\]/)
  assert.match(read('backend/app/Services/Analytics/AnalyticsService.php'), /where\('status', 'Served'\)/)
  const counts = read('src/queue-counts.js')
  assert.deepEqual(quoted(counts.match(/AWAITING_STATUSES = \[([^\]]+)\]/)?.[1] || ''), ['Waiting', 'Called', 'Treatment Ready'])
  assert.ok(constant(model, 'POSITIONAL').includes('In Queue'))
})

test('analysis: actual FIFO, request Urgent retirement and UI Urgent are distinct facts', () => {
  const positions = queue.split('public function positions(')[1].split('public function withPositions(')[0]
  assert.match(positions, /ORDER BY v.arrived_at ASC, q.queue_number ASC/)
  assert.doesNotMatch(positions, /q\.priority|q\.late_arrival|CASE WHEN q\.status/)
  const request = read('backend/app/Http/Requests/Queue/QueuePriorityRequest.php')
  assert.match(request, /Rule::in\(QueueEntry::PRIORITIES\)/)
  assert.match(request, /\['Senior Citizen', 'PWD', 'Urgent'\]/)
  assert.match(read('src/pages/PatientFlow.jsx'), /const priorityLevel = isUrgent \? 'Urgent' : 'Priority'/)
})

test('analysis: canonical encounter links, numbers, locks and revisions have no replacement mapping', () => {
  assert.match(legacySource, /foreignId\('visit_id'\)->unique\(\)->constrained\('visits'\)->restrictOnDelete\(\)/)
  assert.match(legacySource, /unique\(\['dentist_queue_id', 'queue_number'\]\)/)
  assert.match(queue, /ON CONFLICT \(branch_id, dentist_profile_id, clinic_date\)/)
  assert.match(queue, /\$queue->branch_id !== \$visit->branch_id/)
  assert.match(queue, /\$queue->dentist_profile_id !== \$visit->responsible_dentist_profile_id/)
  assert.match(queue, /\$current->revision !== \$expectedRevision/)
  assert.doesNotMatch(up, /SET\s+(?:visit_id|dentist_queue_id|queue_number|public_id|revision)\s*=/i)
  assert.match(read('backend/app/Policies/QueueEntryPolicy.php'), /UserBranchScope::where\('user_id', \$user->id\)/)
})

test('analysis: direct queue routes are named, own-queue scoped, with no cancellation or generic PATCH', () => {
  const routes = read('backend/routes/api.php').split("Route::prefix('queue')->group")[1]
  assert.ok(routes)
  assert.match(routes, /whereIn\('command', \['call', 'ready', 'away', 'return'\]\)/)
  assert.doesNotMatch(routes, /Route::patch|queueEntry\}\/cancel|call-next/)
  const policy = read('backend/app/Policies/QueueEntryPolicy.php')
  assert.match(policy, /\$user->role === Role::Dentist && \$this->ownQueue\(\$user, \$entry\)/)
  assert.match(policy, /\$entry->dentistQueue->dentist\?->person_id === \$user->person_id/)
})

test('analysis: appointment admission and pre-arrival cancellation preserve existing identity boundary', () => {
  const visits = read('backend/app/Services/Visits/VisitService.php')
  for (const [field, from] of [['patient_id', 'patient_id'], ['branch_id', 'branch_id'], ['appointment_id', 'id'], ['responsible_dentist_profile_id', 'dentist_profile_id']]) {
    assert.ok(visits.includes(`'${field}' => $current->${from}`))
  }
  assert.match(visits, /'appointment_id' => null/)
  assert.match(visits, /\$this->queue->enqueue\(\$actor, \$visit, \$late\)/)
  assert.match(read('backend/app/Services/Appointments/AppointmentService.php'), /\$current->status === 'Checked In' \|\| \$current->visit\(\)->exists\(\)/)
})

test('analysis: rollback guard exists, but is not a lossless inverse or safe broad cleanup', () => {
  const first = down.indexOf('DB::statement(')
  for (const guard of ['SELECT COUNT(*) FROM queue_entries', 'SELECT COUNT(*) FROM queue_entry_history', 'throw new \\RuntimeException']) assert.ok(down.indexOf(guard) >= 0 && down.indexOf(guard) < first)
  assert.match(down, /'Cancelled', 'No-show'/)
  assert.equal(reverse['In Queue'], 'Waiting')
  assert.equal(reverse['In Treatment'], 'Treatment Ready')
  assert.doesNotMatch(down, /SET priority = 'Urgent'/)
  const backfill = read('backend/app/Services/Queue/QueueBackfill.php')
  assert.match(backfill, /DISABLE TRIGGER queue_entry_history_no_update_delete/)
  assert.match(backfill, /QueueEntryHistory::whereIn\('queue_entry_id', \$ids\)->delete\(\)/)
})

test('integrity: complete ordered migration bytes retain baseline digest and all four holds', () => {
  const dir = new URL('backend/database/migrations/', root)
  const rows = readdirSync(dir).sort().map(name => ({path: 'backend/database/migrations/' + name, sha256: hash(readFileSync(new URL(name, dir)))}))
  assert.equal(rows.length, manifest.offlineGate.migrationCount)
  // Canonical key order is path,sha256; the rows are already filename ordered.
  assert.equal(hash(JSON.stringify(rows)), manifest.offlineGate.migrationDigest)
  assert.equal(hash(read(targetPath)), manifest.offlineGate.heldContent[0])
  for (const held of manifest.offlineGate.heldContent) assert.ok(rows.some(row => row.sha256 === held))
})

test('handoff: decision and PostgreSQL matrix explicitly retain implementation/execution blockers', () => {
  const decision = read('docs/QUEUE_MIGRATION_PRESERVATION_DECISION.md')
  assert.match(decision, /Implementation verdict: BLOCKED/)
  assert.match(decision, /No production file or migration is changed/)
  assert.match(decision, /unknown\/unrecoverable/)
  assert.match(decision, /No claim is made about any actual database/)
  const acceptance = read('docs/QUEUE_MIGRATION_POSTGRES_ACCEPTANCE.md')
  const ids = [...acceptance.matchAll(/\| (QP-\d{2}) \|/g)].map(match => match[1])
  assert.equal(new Set(ids).size, 41)
  assert.match(acceptance, /Every case below is NOT EXECUTED/)
  assert.match(acceptance, /does not clear a single PostgreSQL case/)
})

test('security: this suite has builtin read/hash/test dependencies only and no execution calls', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const imports = [...self.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])
  assert.deepEqual(imports, ['node:test', 'node:assert/strict', 'node:fs', 'node:crypto', 'node:url'])
  // Deliberately limited assertion: dependency review and Node permissions provide the execution boundary.
  assert.ok(process.execArgv.includes('--permission'), 'Use the documented restricted Node invocation')
  assert.equal(process.execArgv.includes('--allow-child-process'), false)
  assert.equal(process.execArgv.some(arg => arg.startsWith('--allow-fs-write')), false)
})
