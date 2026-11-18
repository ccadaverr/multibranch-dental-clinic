<?php

namespace Tests\Feature\Patients;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\Patient;
use App\Models\Person;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M4 Patient record: one clinic-wide identity, strict public-id binding, role-scoped non-clinical projection, Staff-only
// field-constrained edits with an optimistic revision, and a read-only linked-record index. Clock frozen by
// SchedulingFixture (2026-09-28 10:00 Asia/Manila).
class PatientRecordTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function url(string $key = 'A', string $suffix = ''): string
    {
        return '/api/patients/'.$this->p[$key]->public_id.$suffix;
    }

    /** The Patient has an appointment in b1: Staff scoped to b1 may then read and maintain the full profile. */
    private function relate(string $key = 'A', string $dentist = 'd1', string $branch = 'b1', string $time = '10:00'): void
    {
        $this->existing($key, $dentist, $branch, 'svc1', '2026-09-30', $time);
    }

    private function edit(string $key = 'A', array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->patchJson($this->url($key), $body + ['expected_revision' => $this->p[$key]->fresh()->revision]);
    }

    // ---- identity and binding -------------------------------------------------------------------------------------

    public function test_a_patient_binds_on_the_public_id_only(): void
    {
        $this->actingAsUser('owner');
        $this->getJson($this->url())->assertOk()->assertJsonPath('data.id', $this->p['A']->public_id);
        $this->getJson('/api/patients/'.$this->p['A']->id)->assertNotFound();
        $this->getJson('/api/patients/'.$this->p['A']->patient_code)->assertNotFound();
        $this->getJson('/api/patients/not-a-ulid')->assertNotFound();
        $this->getJson('/api/patients/01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertNotFound(); // well-formed, unknown
    }

    public function test_consent_and_hmo_routes_no_longer_accept_numeric_ids_or_patient_codes(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/patients/'.$this->p['A']->id.'/consents')->assertNotFound();
        $this->getJson('/api/patients/'.$this->p['A']->patient_code.'/consents')->assertNotFound();
        $this->getJson('/api/patients/'.$this->p['A']->id.'/hmo-membership')->assertNotFound();
        $this->getJson($this->url('A', '/consents'))->assertNotFound(); // Staff need a scoped record of this Patient (M14)
        $this->relate();
        $this->getJson($this->url('A', '/consents'))->assertOk();
    }

    public function test_the_document_patient_filter_rejects_non_public_references(): void
    {
        $this->actingAsUser('staffB1');
        $byCode = $this->getJson('/api/documents?patient_id='.$this->p['A']->patient_code)->assertOk();
        $this->assertSame([], $byCode->json('data'));
        $byId = $this->getJson('/api/documents?patient_id='.$this->p['A']->id)->assertOk();
        $this->assertSame([], $byId->json('data'));
    }

    public function test_patient_codes_are_never_reused_after_a_removal(): void
    {
        $this->actingAsUser('staffB1');
        $first = $this->postJson('/api/patients', ['first_name' => 'Ana', 'last_name' => 'Cruz', 'email' => 'ana@example.test'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated();
        $second = $this->postJson('/api/patients', ['first_name' => 'Ben', 'last_name' => 'Diaz', 'email' => 'ben@example.test'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated();
        $this->assertSame('PAT-0003', $first->json('data.code'));
        $this->assertSame('PAT-0004', $second->json('data.code'));
        Person::where('id', Patient::where('patient_code', 'PAT-0003')->value('person_id'))->delete(); // cascades the Patient away
        $third = $this->postJson('/api/patients', ['first_name' => 'Cy', 'last_name' => 'Eve', 'email' => 'cy@example.test'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated();
        $this->assertSame('PAT-0005', $third->json('data.code'), 'a count-based allocator would reissue PAT-0004');
    }

    public function test_walk_in_registration_uses_the_clinic_date_for_the_birth_date_bound(): void
    {
        $this->actingAsUser('staffB1');
        $manilaTomorrow = '2026-09-29';
        $this->postJson('/api/patients', ['first_name' => 'Ana', 'last_name' => 'Cruz', 'date_of_birth' => $manilaTomorrow], ['Idempotency-Key' => 'k'.(++$this->keys)])
            ->assertStatus(422)->assertJsonValidationErrors('date_of_birth');
        $this->postJson('/api/patients', ['first_name' => 'Ana', 'last_name' => 'Cruz', 'date_of_birth' => '2026-09-28'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated();
    }

    public function test_walk_in_registration_is_audited_without_personal_values(): void
    {
        $this->actingAsUser('staffB1');
        $id = $this->postJson('/api/patients', ['first_name' => 'Secretname', 'last_name' => 'Cruz', 'phone' => '+639171234567'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated()->json('data.id');
        $log = AuditLog::where('action', 'patient.registered')->sole();
        $this->assertSame($id, $log->auditable_public_id);
        $this->assertStringNotContainsString('Secretname', json_encode($log->payload));
        $this->assertStringNotContainsString('+63917', json_encode($log->payload));
    }

    // ---- read access matrix ---------------------------------------------------------------------------------------

    public function test_read_access_by_role(): void
    {
        $this->actingAsUser('patientA');
        $this->getJson($this->url('A'))->assertOk()->assertJsonPath('data.profile_access', 'full');
        $this->getJson($this->url('B'))->assertNotFound();

        $this->actingAsUser('staffNone');
        $this->getJson($this->url('A'))->assertNotFound();

        // No record of A in any branch yet: scoped Staff and the Owner reach only the identity tier (the directory fields).
        foreach (['staffB1', 'staffB2', 'staffBoth', 'owner'] as $who) {
            $this->actingAsUser($who);
            $this->getJson($this->url('A'))->assertOk()->assertJsonPath('data.profile_access', 'identity');
        }

        // An appointment in b1 makes the full profile readable to Staff scoped to b1, and only to them.
        $this->relate();
        $expect = ['staffB1' => 'full', 'staffBoth' => 'full', 'staffB2' => 'identity', 'owner' => 'identity'];
        foreach ($expect as $who => $tier) {
            $this->actingAsUser($who);
            $this->getJson($this->url('A'))->assertOk()->assertJsonPath('data.profile_access', $tier);
        }
    }

    public function test_dentists_have_no_generic_patient_record_access_even_with_workflow_records(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->actingAsUser('dentist1');
        $this->getJson($this->url('A'))->assertForbidden();
        $this->getJson($this->url('A', '/records'))->assertForbidden();
        $this->patchJson($this->url('A'), ['expected_revision' => 1, 'phone' => '+639171111111'])->assertForbidden();
        // Existing workflow-specific Dentist entitlements are untouched: the Dentist still reads their own appointment.
        $this->getJson('/api/appointments/'.$a->public_id)->assertOk()->assertJsonPath('data.patient.id', $this->p['A']->public_id);
        $this->assertNotEmpty($this->getJson('/api/appointments')->assertOk()->json('data'));
    }

    public function test_guests_are_unauthenticated(): void
    {
        $this->getJson($this->url())->assertUnauthorized();
        $this->patchJson($this->url(), ['expected_revision' => 1])->assertUnauthorized();
        $this->getJson($this->url('A', '/records'))->assertUnauthorized();
    }

    public function test_projection_has_two_tiers_and_never_exposes_internal_or_clinical_data(): void
    {
        $this->p['A']->person->update(['first_name' => 'Maria', 'last_name' => 'Santos', 'phone' => '+639171234567', 'address' => '1 Main St', 'sex' => 'Female', 'date_of_birth' => '1990-05-06']);
        $this->relate();

        $this->actingAsUser('staffB1');
        $full = $this->getJson($this->url())->assertOk()->json('data');
        foreach (['id', 'code', 'name', 'first_name', 'last_name', 'date_of_birth', 'phone', 'profile_access', 'sex', 'email', 'address', 'emergency_contact', 'preferred_branch', 'revision', 'has_portal_account'] as $key) {
            $this->assertArrayHasKey($key, $full);
        }
        $this->assertTrue($full['has_portal_account']);
        $this->assertStringContainsString('+08:00', $full['created_at']);

        $this->actingAsUser('owner');
        $identity = $this->getJson($this->url())->assertOk()->json('data');
        $this->assertSame(['id', 'code', 'name', 'first_name', 'last_name', 'date_of_birth', 'phone', 'profile_access'], array_keys($identity));

        $all = json_encode([$full, $identity]);
        foreach (['person_id', 'user_id', 'password', 'allergies', 'medical_history', 'dental_history', 'auth_version', 'consent'] as $leak) {
            $this->assertStringNotContainsString('"'.$leak.'"', $all, "{$leak} must not be projected");
        }
        $this->assertNotContains($this->p['A']->id, array_filter($full, 'is_int'), 'the bigint id is never exposed');
    }

    public function test_the_patient_sees_their_own_profile_but_no_other_patients(): void
    {
        $this->actingAsUser('patientB');
        $this->getJson($this->url('B'))->assertOk()->assertJsonPath('data.code', 'PAT-0002');
        foreach (['A'] as $other) {
            $this->getJson($this->url($other))->assertNotFound();
            $this->getJson($this->url($other, '/records'))->assertNotFound();
        }
    }

    public function test_the_patient_directory_is_unchanged_and_not_for_patients_or_dentists(): void
    {
        $this->actingAsUser('patientA');
        $this->getJson('/api/patients')->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->getJson('/api/patients')->assertForbidden();
        $this->actingAsUser('staffB1');
        $rows = $this->getJson('/api/patients?search=PAT-0001')->assertOk()->json('data');
        $this->assertSame([$this->p['A']->public_id], array_column($rows, 'id'));
        $this->assertArrayNotHasKey('email', $rows[0]);
    }

    // ---- update: authority, allowlist, revision -------------------------------------------------------------------

    public function test_only_staff_with_a_scoped_record_of_the_patient_may_edit_the_profile(): void
    {
        $this->relate();
        foreach (['patientA', 'dentist1', 'owner', 'staffNone', 'staffB2'] as $who) {
            $this->actingAsUser($who);
            $this->edit('A', ['phone' => '+639171111111'])->assertForbidden();
        }
        $this->assertNotSame('+639171111111', $this->p['A']->person->fresh()->phone);
        $this->actingAsUser('staffBoth');
        $this->edit('A', ['phone' => '+639171111111'])->assertOk()->assertJsonPath('data.phone', '+639171111111')->assertJsonPath('data.revision', 2);
    }

    public function test_scoped_staff_cannot_edit_a_patient_with_no_record_in_their_branches(): void
    {
        $this->actingAsUser('staffB1');
        $this->edit('A', ['phone' => '+639171111111'])->assertForbidden(); // identity tier only: nothing of A's in b1
        $this->relate('A', 'd3', 'b2', '12:00');
        $this->edit('A', ['phone' => '+639171111111'])->assertForbidden(); // a b2 record does not help Staff scoped to b1
        $this->relate('A', 'd1', 'b1', '14:00');
        $this->edit('A', ['phone' => '+639171111111'])->assertOk();
    }

    public function test_a_patient_cannot_edit_their_own_record(): void
    {
        $this->actingAsUser('patientA');
        $this->edit('A', ['phone' => '+639171111111'])->assertForbidden();
    }

    public function test_staff_edit_changes_only_allowlisted_nonclinical_fields_and_audits_field_names(): void
    {
        $this->relate();
        $this->p['A']->person->update(['first_name' => 'Maria', 'last_name' => 'Santos', 'phone' => '+639170000001', 'sex' => 'Female', 'date_of_birth' => '1980-01-01', 'address' => null]);
        $this->actingAsUser('staffB1');
        $response = $this->edit('A', [
            'first_name' => 'Marie', 'last_name' => 'Santos', 'phone' => '+639171234567', 'date_of_birth' => '1990-05-06', 'sex' => 'Other',
            'address' => '1 Main St', 'emergency_contact' => 'Juan, brother, +639170000000', 'preferred_branch_id' => 'b2',
        ])->assertOk();
        $response->assertJsonPath('data.preferred_branch.id', 'b2')->assertJsonPath('data.revision', 2);
        $person = $this->p['A']->person->fresh();
        $this->assertSame(['Marie', '1990-05-06', '+639171234567'], [$person->first_name, $person->date_of_birth->toDateString(), $person->phone]);
        $this->assertSame('Juan, brother, +639170000000', $this->p['A']->fresh()->emergency_contact);

        $log = AuditLog::where('action', 'patient.profile.updated')->sole();
        $this->assertSame($this->p['A']->public_id, $log->auditable_public_id);
        $this->assertEqualsCanonicalizing(['first_name', 'phone', 'date_of_birth', 'sex', 'address', 'emergency_contact', 'preferred_branch_id'], $log->payload['fields']);
        foreach (['Marie', '1 Main St', 'Juan', '+63917'] as $value) {
            $this->assertStringNotContainsString($value, json_encode($log->payload), 'personal values never enter the audit payload');
        }
    }

    public function test_an_unchanged_save_does_not_bump_the_revision_or_audit(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $this->edit('A', ['phone' => '+639171111111'])->assertOk();
        $this->edit('A', ['phone' => '+639171111111'])->assertOk()->assertJsonPath('data.revision', 2);
        $this->assertSame(1, AuditLog::where('action', 'patient.profile.updated')->count());
    }

    public function test_clinical_identity_and_authorization_fields_are_refused_not_stripped(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $before = [$this->p['A']->fresh()->only(['public_id', 'patient_code', 'person_id', 'consent', 'revision']), $this->p['A']->person->fresh()->toArray()];
        foreach ([
            'allergies', 'medical_history', 'dental_history', 'clinical_notes',
            'id', 'public_id', 'patient_code', 'person_id', 'user_id', 'patient_id', 'role', 'account_status', 'password', 'branch_scopes',
            'consent', 'revision', 'created_by', 'approved_by', 'created_at', 'updated_at',
        ] as $field) {
            $this->edit('A', [$field => 'x'])->assertStatus(422)->assertJsonValidationErrors($field);
        }
        $this->assertSame($before, [$this->p['A']->fresh()->only(['public_id', 'patient_code', 'person_id', 'consent', 'revision']), $this->p['A']->person->fresh()->toArray()]);
    }

    public function test_invalid_values_are_refused(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $this->edit('A', ['first_name' => ''])->assertStatus(422)->assertJsonValidationErrors('first_name');
        $this->edit('A', ['phone' => '0917'])->assertStatus(422)->assertJsonValidationErrors('phone');
        $this->edit('A', ['date_of_birth' => '2026-09-29'])->assertStatus(422)->assertJsonValidationErrors('date_of_birth'); // after the Manila date
        $this->edit('A', ['date_of_birth' => '06/05/1990'])->assertStatus(422)->assertJsonValidationErrors('date_of_birth');
        $this->edit('A', ['first_name' => ['x']])->assertStatus(422)->assertJsonValidationErrors('first_name');
        $this->edit('A', ['preferred_branch_id' => 'nope'])->assertStatus(422)->assertJsonPath('code', 'branch_not_found');
        $this->edit('A', ['preferred_branch_id' => (string) $this->b['b1']->id])->assertStatus(422)->assertJsonPath('code', 'branch_not_found'); // bigint is not a branch reference
        $this->patchJson($this->url(), ['phone' => '+639171111111'])->assertStatus(422)->assertJsonValidationErrors('expected_revision');
    }

    public function test_a_stale_revision_is_a_409_and_changes_nothing(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $this->edit('A', ['phone' => '+639171111111'])->assertOk();
        $this->patchJson($this->url(), ['phone' => '+639172222222', 'expected_revision' => 1])
            ->assertStatus(409)->assertJsonPath('code', 'stale_revision')->assertJsonPath('current_revision', 2);
        $this->assertSame('+639171111111', $this->p['A']->person->fresh()->phone);
    }

    public function test_the_preferred_branch_can_be_set_by_public_id_and_cleared(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $this->edit('A', ['preferred_branch_id' => $this->b['b2']->public_id])->assertOk()->assertJsonPath('data.preferred_branch.id', 'b2');
        $this->edit('A', ['preferred_branch_id' => null])->assertOk()->assertJsonPath('data.preferred_branch', null);
    }

    public function test_email_of_an_account_holder_is_owned_by_m1_and_a_free_email_is_unique_across_people_and_users(): void
    {
        $this->relate();
        $this->actingAsUser('staffB1');
        $this->edit('A', ['email' => 'new@example.test'])->assertStatus(422)->assertJsonPath('code', 'email_managed_by_account');

        $walkIn = $this->postJson('/api/patients', ['first_name' => 'Walk', 'last_name' => 'In'], ['Idempotency-Key' => 'k'.(++$this->keys)])->assertCreated()->json('data.id');
        $this->p['W'] = Patient::where('public_id', $walkIn)->sole();
        $this->existing('W', 'd1', 'b1', 'svc1', '2026-10-02', '11:00');
        $patch = fn (string $email) => $this->patchJson('/api/patients/'.$walkIn, ['expected_revision' => Patient::where('public_id', $walkIn)->value('revision'), 'email' => $email]);
        $patch($this->p['A']->person->email)->assertStatus(422)->assertJsonPath('code', 'patient_email_exists');
        $patch($this->u['staffB1']->email)->assertStatus(422)->assertJsonPath('code', 'patient_email_exists');
        $patch('  Walk@Example.Test ')->assertOk()->assertJsonPath('data.email', 'walk@example.test');
    }

    public function test_a_patient_record_is_one_identity_across_branches(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->existing('A', 'd3', 'b2', 'svc1', '2026-10-01', '10:00');
        $this->actingAsUser('owner');
        $rows = $this->getJson($this->url('A', '/records'))->assertOk()->json('data.appointments');
        $this->assertEqualsCanonicalizing(['b1', 'b2'], array_column(array_column($rows, 'branch'), 'id'));
        $this->assertSame(1, Patient::where('patient_code', 'PAT-0001')->count());
    }

    // ---- longitudinal index ---------------------------------------------------------------------------------------

    public function test_the_record_index_links_other_modules_records_without_copying_their_data(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->actingAsUser('owner');
        $data = $this->getJson($this->url('A', '/records'))->assertOk()->json('data');
        $this->assertSame($a->public_id, $data['appointments'][0]['id']);
        $this->assertSame(['id', 'code', 'status', 'starts_at', 'branch'], array_keys($data['appointments'][0]));
        $this->assertSame(['clinical_history', 'prescriptions', 'follow_ups'], $data['unavailable']);
        foreach (['visits', 'treatments', 'invoices', 'hmo_cases'] as $family) {
            $this->assertArrayHasKey($family, $data);
        }
        $this->assertStringNotContainsString('patient_responsibility', json_encode($data), 'no second copy of billing amounts');
    }

    public function test_the_record_index_is_filtered_by_each_modules_own_read_scope(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->existing('A', 'd3', 'b2', 'svc1', '2026-10-01', '10:00');

        $this->actingAsUser('staffB1');
        $this->assertCount(1, $this->getJson($this->url('A', '/records'))->json('data.appointments'));
        $this->actingAsUser('staffBoth');
        $this->assertCount(2, $this->getJson($this->url('A', '/records'))->json('data.appointments'));
        $this->actingAsUser('patientA');
        $this->assertCount(2, $this->getJson($this->url('A', '/records'))->json('data.appointments'));
        $this->actingAsUser('staffNone');
        $this->getJson($this->url('A', '/records'))->assertNotFound();
    }

    public function test_internal_ids_never_appear_in_the_record_index(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->actingAsUser('owner');
        $json = json_encode($this->getJson($this->url('A', '/records'))->assertOk()->json());
        $this->assertDoesNotMatchRegularExpression('/"(patient_id|person_id|user_id|visit_id|dentist_profile_id|branch_id)"/', $json);
    }

    public function test_the_owner_has_the_identity_tier_only_and_cannot_edit(): void
    {
        $this->relate();
        $this->actingAsUser('owner');
        $this->getJson($this->url())->assertOk()->assertJsonMissingPath('data.email')->assertJsonMissingPath('data.address');
        $this->edit('A', ['phone' => '+639171111111'])->assertForbidden();
    }

    public function test_document_upload_names_the_patient_by_public_id_only(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $this->actingAsUser('staffB1');
        $file = fn () => \Illuminate\Http\UploadedFile::fake()->createWithContent('consent.pdf', "%PDF-1.4\n%%EOF");
        foreach ([$this->p['A']->patient_code, (string) $this->p['A']->id] as $bad) {
            $this->postJson('/api/documents', ['file' => $file(), 'patient_id' => $bad, 'branch_id' => 'b1', 'category' => 'consent_document'])
                ->assertStatus(404);
        }
        $this->relate();
        $this->postJson('/api/documents', ['file' => $file(), 'patient_id' => $this->p['A']->public_id, 'branch_id' => 'b1', 'category' => 'consent_document'],
            ['Idempotency-Key' => 'scoped-patient-document'])->assertCreated();
    }

    public function test_changing_a_staff_members_assigned_branch_enforces_updated_scope_server_side(): void
    {
        $this->relate('A', 'd1', 'b1', '10:00');
        $this->relate('B', 'd3', 'b2', '11:00');

        $staffProfile = \App\Models\StaffProfile::create([
            'legacy_ref' => 's1',
            'legacy_user_ref' => 'u2',
            'title' => 'Receptionist',
            'person_id' => $this->u['staffB1']->person_id,
            'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00',
            'shift_end' => '18:00',
            'available' => true,
        ]);

        // Initially staffB1 is assigned to b1: full access to A (in b1), identity-only (no edit) on B (in b2).
        $this->actingAsUser('staffB1');
        $this->getJson($this->url('A'))->assertOk()->assertJsonPath('data.profile_access', 'full');
        $this->edit('A', ['phone' => '+639171111111'])->assertOk();
        $this->getJson($this->url('B'))->assertOk()->assertJsonPath('data.profile_access', 'identity');
        $this->edit('B', ['phone' => '+639172222222'])->assertForbidden();

        // Owner changes staffB1's assigned branch to b2 via StaffProfile update.
        $this->actingAsUser('owner');
        $this->patchJson('/api/staff/'.$staffProfile->legacy_ref, \Tests\Support\StaffProfileCommand::body($staffProfile->legacy_ref, ['branch_ref' => 'b2']))
            ->assertOk()
            ->assertJsonPath('data.branchId', 'b2');

        // Immediately enforced server-side: staffB1 can no longer edit or view full profile/records of A in b1,
        // and now has full profile and edit access to B in b2.
        $this->actingAsUser('staffB1');
        $this->getJson($this->url('A'))->assertOk()->assertJsonPath('data.profile_access', 'identity');
        $this->edit('A', ['phone' => '+639173333333'])->assertForbidden();
        $this->assertCount(0, $this->getJson($this->url('A', '/records'))->assertOk()->json('data.appointments'));

        $this->getJson($this->url('B'))->assertOk()->assertJsonPath('data.profile_access', 'full');
        $this->edit('B', ['phone' => '+639172222222'])->assertOk()->assertJsonPath('data.phone', '+639172222222');
        $this->assertCount(1, $this->getJson($this->url('B', '/records'))->assertOk()->json('data.appointments'));
    }
}
