<?php

namespace Tests\Feature\Visits;

use App\Enums\Role;
use App\Models\UserBranchScope;
use App\Models\Visit;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class VisitReadPrivacyTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const MISSING = '00000000000000000000000000';

    private Visit $scheduled;

    private Visit $foreign;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        $id = $this->postJson('/api/visits/check-in', [
            'appointment_id' => $appointment->public_id, 'expected_revision' => 1, 'id_confirmed' => true,
        ], ['Idempotency-Key' => 'private-read-scheduled'])->assertCreated()->json('data.id');
        $this->scheduled = Visit::where('public_id', $id)->sole();

        $this->actingAsUser('staffB2');
        $id = $this->postJson('/api/visits/walk-in', [
            'patient_id' => $this->p['B']->public_id, 'branch_ref' => 'b2', 'service_ref' => 'svc1', 'dentist_ref' => 'd3',
        ], ['Idempotency-Key' => 'private-read-foreign'])->assertCreated()->json('data.id');
        $this->foreign = Visit::where('public_id', $id)->sole();
        $this->assertFalse(Visit::where('public_id', self::MISSING)->exists());
    }

    private function readVisit(string $id): TestResponse
    {
        return $this->getJson('/api/visits/'.rawurlencode($id));
    }

    private function assertPrivate(TestResponse $response): void
    {
        $this->assertStringContainsString('private', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    private function assertHidden(TestResponse $response): void
    {
        // Exact equality also rejects IDs, names, relationships, policy/debug traces and internal metadata.
        $response->assertNotFound()->assertExactJson(['message' => 'Visit not found.']);
        $this->assertPrivate($response);
    }

    private function assertExactVisit(TestResponse $response, Visit $visit): void
    {
        $response->assertOk()
            ->assertJsonPath('data.id', $visit->public_id)
            ->assertJsonPath('data.patient.id', $visit->patient->public_id)
            ->assertJsonPath('data.branch.id', $visit->branch->legacy_ref)
            ->assertJsonPath('data.dentist.id', $visit->dentist->legacy_ref)
            ->assertJsonPath('data.appointment.id', $visit->appointment?->public_id)
            ->assertJsonPath('data.queue.id', $visit->queueEntry->public_id)
            ->assertJsonPath('data.history.0.event', 'visit.checked_in')
            ->assertJsonPath('data.status', 'Checked In');
        $this->assertPrivate($response);
        foreach (['patient_id', 'branch_id', 'person_id', 'appointment_id', 'created_by_user_id', 'responsible_dentist_profile_id'] as $internal) {
            $this->assertStringNotContainsString('"'.$internal.'":', $response->getContent());
        }
    }

    public function test_authorized_staff_reads_exact_scheduled_and_walk_in_relationships(): void
    {
        $this->actingAsUser('staffBoth');
        $this->assertExactVisit($this->readVisit($this->scheduled->public_id), $this->scheduled);
        $this->assertExactVisit($this->readVisit($this->foreign->public_id), $this->foreign);
        $this->assertSame(2, Visit::count());
    }

    public function test_responsible_dentist_reads_the_exact_visit(): void
    {
        $this->actingAsUser('dentist1');
        $this->assertExactVisit($this->readVisit($this->scheduled->public_id), $this->scheduled);
    }

    public function test_owner_existing_visit_oversight_is_preserved(): void
    {
        $this->actingAsUser('owner');
        $this->assertExactVisit($this->readVisit($this->foreign->public_id), $this->foreign);
    }

    public function test_foreign_branch_and_nonexistent_visits_have_identical_sanitized_responses(): void
    {
        config(['app.debug' => true]);
        $this->actingAsUser('staffB1');
        $foreign = $this->readVisit($this->foreign->public_id);
        $missing = $this->readVisit(self::MISSING);
        $this->assertHidden($foreign);
        $this->assertHidden($missing);
        $this->assertSame($foreign->getContent(), $missing->getContent());
    }

    public function test_unrelated_dentists_cannot_distinguish_an_existing_patient_visit(): void
    {
        // d2 belongs to the same branch as d1: branch membership does not confer Visit responsibility.
        foreach (['dentist2', 'dentist3'] as $actor) {
            $this->actingAsUser($actor);
            $existing = $this->readVisit($this->scheduled->public_id);
            $missing = $this->readVisit(self::MISSING);
            $this->assertHidden($existing);
            $this->assertHidden($missing);
            $this->assertSame($existing->getContent(), $missing->getContent());
        }
    }

    public function test_patient_role_has_no_direct_visit_access_even_to_its_own_visit(): void
    {
        $this->actingAsUser('patientA');
        foreach ([$this->scheduled->public_id, $this->foreign->public_id, self::MISSING] as $id) {
            $this->assertHidden($this->readVisit($id));
        }
        // The separate collection and all clinical commands retain their role restrictions.
        $this->getJson('/api/visits')->assertForbidden();
    }

    public function test_numeric_legacy_and_malformed_identifiers_never_resolve_internal_ids(): void
    {
        config(['app.debug' => true]);
        foreach (['staffB1', 'dentist1', 'patientA', 'owner'] as $actor) {
            $this->actingAsUser($actor);
            foreach ([(string) $this->scheduled->id, '9999999999999999999', 'legacy-visit', 'bad!', str_repeat('i', 26)] as $id) {
                $this->assertHidden($this->readVisit($id));
            }
        }
    }

    public function test_unauthenticated_denials_do_not_depend_on_visit_existence_or_format(): void
    {
        Auth::forgetGuards();
        $body = null;
        foreach ([$this->scheduled->public_id, self::MISSING, (string) $this->scheduled->id, 'bad!'] as $id) {
            $response = $this->readVisit($id)->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
            $body ??= $response->getContent();
            $this->assertSame($body, $response->getContent());
        }
    }

    public function test_revoked_branch_authorization_is_rechecked_with_a_cached_actor(): void
    {
        $this->actingAsUser('staffB1');
        $this->readVisit($this->scheduled->public_id)->assertOk();
        $this->actingAsUser('owner');
        $this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes', ['branch_refs' => []])->assertOk();
        $this->actingAsUser('staffB1');
        $this->assertHidden($this->readVisit($this->scheduled->public_id));
        $this->assertHidden($this->readVisit(self::MISSING));
    }

    public function test_revoked_role_does_not_reuse_the_authenticated_objects_old_role(): void
    {
        $this->u['dentist1']->fresh()->update(['role' => Role::Patient]);
        // Deliberately keep the old in-memory Dentist identity, as an existing session would.
        $this->actingAsUser('dentist1');
        $this->assertHidden($this->readVisit($this->scheduled->public_id));
        $this->assertHidden($this->readVisit(self::MISSING));
    }

    public function test_suspended_sessions_are_denied_before_existing_missing_or_malformed_lookup(): void
    {
        $this->u['staffB1']->fresh()->update(['account_status' => 'Suspended']);
        $body = null;
        foreach ([$this->scheduled->public_id, self::MISSING, 'bad!'] as $id) {
            $this->actingAsUser('staffB1');
            $response = $this->readVisit($id)->assertForbidden()->assertExactJson([
                'message' => 'Your session has ended. Sign in again.', 'code' => 'session_revoked',
            ]);
            $body ??= $response->getContent();
            $this->assertSame($body, $response->getContent());
        }
    }

    public function test_stale_web_session_revision_is_denied_independently_of_visit_existence(): void
    {
        $staff = $this->u['staffB1'];
        $version = (int) $staff->auth_version;
        $staff->fresh()->increment('auth_version');
        foreach ([$this->scheduled->public_id, self::MISSING, 'bad!'] as $id) {
            Auth::forgetGuards();
            $this->actingAs($staff->fresh(), 'web')->withSession(['auth_version' => $version]);
            $this->readVisit($id)->assertForbidden()->assertExactJson([
                'message' => 'Your session has ended. Sign in again.', 'code' => 'session_revoked',
            ]);
        }
    }

    public function test_policy_rechecks_branch_revocation_between_scoped_lookup_and_projection(): void
    {
        $this->actingAsUser('staffB1');
        $revoked = false;
        // Deterministic interleaving on real PostgreSQL, not a claimed independent-process race.
        DB::listen(function (QueryExecuted $query) use (&$revoked): void {
            if (! $revoked && str_starts_with($query->sql, 'select') && str_contains($query->sql, 'from "visits"') && str_contains($query->sql, '"public_id"')) {
                $revoked = true;
                UserBranchScope::where('user_id', $this->u['staffB1']->id)->delete();
            }
        });
        $this->assertHidden($this->readVisit($this->scheduled->public_id));
        $this->assertTrue($revoked);
    }

    public function test_policy_uses_the_refreshed_role_instead_of_a_cached_owner_identity(): void
    {
        $owner = $this->u['owner'];
        $owner->fresh()->update(['role' => Role::Staff]);
        UserBranchScope::create(['user_id' => $owner->id, 'branch_id' => $this->b['b1']->id]);
        $this->actingAsUser('owner'); // Guard still holds the old Owner object; request middleware refreshes it.
        $revoked = false;
        DB::listen(function (QueryExecuted $query) use (&$revoked, $owner): void {
            if (! $revoked && str_starts_with($query->sql, 'select') && str_contains($query->sql, 'from "visits"') && str_contains($query->sql, '"public_id"')) {
                $revoked = true;
                UserBranchScope::where('user_id', $owner->id)->delete();
            }
        });
        $this->assertHidden($this->readVisit($this->scheduled->public_id));
        $this->assertTrue($revoked);
    }
}
