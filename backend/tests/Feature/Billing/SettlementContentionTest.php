<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Receipt;
use App\Models\ServicePrice;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed synthetic fixtures ONLY on a new verified clone. No migration, reset or cleanup. */
class SettlementContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('BILLING_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') {
            self::markTestSkipped('Use the explicit billing-concurrency runner on a fresh clone.');
        }
        parent::setUp();
        self::assertSame(0, DB::transactionLevel());
        foreach (['branches', 'users', 'patients', 'invoices', 'payments', 'receipts'] as $table) {
            self::assertSame(0, DB::table($table)->count(), 'Fresh disposable clone only.');
        }
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-01 00:00:00+08']);
        ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'branch_id' => $this->b['b1']->id, 'kind' => 'priced', 'amount' => '125.50', 'effective_from' => '2026-09-01', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);
    }

    private function issued(int $index): Invoice
    {
        $this->actingAsUser('staffB1');
        $a = $this->staffBook(['date' => '2026-09-28', 'start_time' => (11 + $index).':00', 'dentist_ref' => 'd1'], ['Idempotency-Key' => 'race-book-'.$index])->assertCreated()->json('data');
        $v = $this->postJson('/api/visits/check-in', ['appointment_id' => $a['id'], 'expected_revision' => 1], ['Idempotency-Key' => 'race-arrive-'.$index])->assertCreated()->json('data');
        $this->actingAsUser('dentist1');
        $this->postJson('/api/queue/'.$v['queue']['id'].'/call', ['expected_revision' => 1], ['Idempotency-Key' => 'race-call-'.$index])->assertOk();
        $t = $this->postJson('/api/visits/'.$v['id'].'/treatment', ['expected_revision' => 1], ['Idempotency-Key' => 'race-start-'.$index])->assertCreated()->json('data');
        $this->postJson('/api/treatments/'.$t['id'].'/document', ['expected_revision' => 1, 'procedure_summary' => 'Synthetic performed procedure', 'prescription_required' => false, 'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]], ['Idempotency-Key' => 'race-document-'.$index])->assertOk();
        $this->postJson('/api/treatments/'.$t['id'].'/complete', ['expected_revision' => 2], ['Idempotency-Key' => 'race-complete-'.$index])->assertOk();
        $this->actingAsUser('staffB1');
        $id = $this->postJson('/api/invoices/from-treatment/'.$t['id'], [], ['Idempotency-Key' => 'race-draft-'.$index])->assertCreated()->json('data.id');
        $this->postJson('/api/invoices/'.$id.'/review', ['expected_revision' => 1], ['Idempotency-Key' => 'race-review-'.$index])->assertOk();
        $this->postJson('/api/invoices/'.$id.'/issue', ['expected_revision' => 2], ['Idempotency-Key' => 'race-issue-'.$index])->assertOk();

        return Invoice::where('public_id', $id)->sole();
    }

    public function test_real_invoice_lock_contention_preserves_one_collection_for_competing_and_replayed_intents(): void
    {
        $token = $this->u['staffB1']->createToken('synthetic-settlement-contention')->plainTextToken;
        foreach (['different_keys', 'same_key', 'contradictory_same_key'] as $index => $scenario) {
            $i = $this->issued($index);
            $workers = [];
            $names = [];
            DB::beginTransaction();
            try {
                Invoice::whereKey($i->id)->lockForUpdate()->firstOrFail();
                foreach ([0, 1] as $n) {
                    $name = 'billing_'.getmypid().'_'.$index.'_'.$n;
                    $names[] = $name;
                    $body = ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '125.50'];
                    if ($scenario === 'contradictory_same_key' && $n === 1) {
                        $body['method'] = 'E-Wallet';
                        $body['external_reference'] = 'SYNTHETIC-WALLET';
                    }
                    $key = 'settlement-'.$index.'-'.($scenario === 'different_keys' ? $n : 0);
                    $p = new Process([PHP_BINARY, base_path('tests/Support/billing_settlement_worker.php')], base_path(), getenv(), json_encode(['worker' => $name, 'token' => $token, 'path' => '/api/invoices/'.$i->public_id.'/payment', 'body' => $body, 'key' => $key]), 30);
                    $p->start();
                    $workers[] = $p;
                }
                $deadline = microtime(true) + 10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'", $names)->n;
                    if ($waiting === 2) {
                        break;
                    }
                    foreach ($workers as $w) {
                        self::assertTrue($w->isRunning(), 'Worker exited before actual contention.');
                    }
                    usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(2, $waiting, 'Both independent connections must wait on real PostgreSQL locks.');
                DB::commit();
                $results = [];
                foreach ($workers as $w) {
                    self::assertSame(0, $w->wait(), 'Worker failed.');
                    $results[] = json_decode($w->getOutput(), true, flags: JSON_THROW_ON_ERROR);
                }
            } finally {
                if (DB::transactionLevel()) {
                    DB::rollBack();
                }foreach ($workers as $w) {
                    if ($w->isRunning()) {
                        $w->stop();
                    }
                }
            }
            $statuses = array_column($results, 'status');
            sort($statuses);
            self::assertSame($scenario === 'same_key' ? [200, 200] : [200, 409], $statuses);
            if ($scenario === 'same_key') {
                self::assertSame($results[0]['body'], $results[1]['body']);
            }
            self::assertSame('Paid', $i->fresh()->status);
            self::assertSame('0.00', $i->fresh()->balance());
            self::assertSame(1, Payment::where('invoice_id', $i->id)->count());
            self::assertSame(1, Receipt::where('invoice_id', $i->id)->count());
            self::assertSame(1,$i->histories()->where('event','invoice.paid')->count());
        }
    }
}
