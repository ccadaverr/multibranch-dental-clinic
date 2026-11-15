<?php

namespace Tests\Feature\Reference;

use App\Enums\Role;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Person;
use App\Models\Service;
use App\Models\StaffProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Phase 2A: the read/mutation role matrix, plus route-binding-by-legacy_ref proof (plan section H/I/N).
class ReferenceDataAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private function userWithRole(Role $role): User
    {
        $person = Person::factory()->create();

        return User::factory()->create([
            'person_id' => $person->id,
            'role' => $role,
            'password' => Hash::make('Passw0rd!'),
        ]);
    }

    private function branch(string $ref = 'b1'): Branch
    {
        return Branch::create([
            'legacy_ref' => $ref, 'branch_code' => 'BRC-'.strtoupper($ref), 'name' => 'Branch '.strtoupper($ref),
            'city' => 'Bocaue', 'address' => '123 St', 'open_time' => '09:00', 'close_time' => '18:00',
            'status' => 'Open', 'capacity_threshold' => 80,
        ]);
    }

    private function service(string $ref = 'svc1'): Service
    {
        return Service::create([
            'legacy_ref' => $ref, 'code' => strtoupper($ref), 'name' => 'Service '.$ref,
            'duration_minutes' => 30, 'reference_fee_php' => 600, 'category' => 'General Dentistry', 'status' => 'Active',
        ]);
    }

    private function staffProfile(string $ref = 's1', ?Branch $branch = null): StaffProfile
    {
        $person = Person::factory()->create();

        return StaffProfile::create([
            'legacy_ref' => $ref, 'person_id' => $person->id, 'branch_id' => ($branch ?? $this->branch('branch-for-'.$ref))->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
        ]);
    }

    private function dentistProfile(string $ref = 'd1'): DentistProfile
    {
        $person = Person::factory()->create();

        return DentistProfile::create([
            'legacy_ref' => $ref, 'person_id' => $person->id, 'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
        ]);
    }

    public static function readRoutes(): array
    {
        return [
            'branches' => ['/api/branches'],
            'services' => ['/api/services'],
            'branch-services' => ['/api/branch-services'],
            'dentists' => ['/api/dentists'],
        ];
    }

    #[DataProvider('readRoutes')]
    public function test_every_role_can_read_non_staff_reference_data(string $route): void
    {
        foreach (Role::cases() as $role) {
            Sanctum::actingAs($this->userWithRole($role));
            $this->getJson($route)->assertOk();
        }
    }

    #[DataProvider('readRoutes')]
    public function test_unauthenticated_is_rejected(string $route): void
    {
        $this->getJson($route)->assertStatus(401);
    }

    public function test_staff_directory_denies_patient_but_allows_staff_dentist_owner(): void
    {
        Sanctum::actingAs($this->userWithRole(Role::Patient));
        $this->getJson('/api/staff')->assertForbidden();

        foreach ([Role::Staff, Role::Dentist, Role::Owner] as $role) {
            Sanctum::actingAs($this->userWithRole($role));
            $this->getJson('/api/staff')->assertOk();
        }
    }

    public static function mutationKinds(): array
    {
        return [
            'branch update' => ['branch update'],
            'branch-service toggle' => ['branch-service toggle'],
            'staff update' => ['staff update'],
            'dentist update' => ['dentist update'],
        ];
    }

    #[DataProvider('mutationKinds')]
    public function test_only_owner_may_mutate(string $kind): void
    {
        foreach (Role::cases() as $role) {
            // Fresh resource per role iteration (own unique legacy_ref) so each role hits a route that
            // genuinely exists, without colliding with a previous iteration's row.
            $suffix = $role->value;
            [$method, $route, $body] = match ($kind) {
                'branch update' => ['patch', '/api/branches/'.$this->branch('b-'.$suffix)->legacy_ref, ['city' => 'Malolos']],
                'branch-service toggle' => ['post', '/api/branch-services', [
                    'branch_ref' => $this->branch('bb-'.$suffix)->legacy_ref,
                    'service_ref' => $this->service('sv-'.$suffix)->legacy_ref,
                    'active' => true,
                ]],
                'staff update' => ['patch', '/api/staff/'.$this->staffProfile('s-'.$suffix)->legacy_ref, ['available' => false]],
                'dentist update' => ['patch', '/api/dentists/'.$this->dentistProfile('d-'.$suffix)->legacy_ref, ['available' => false]],
            };
            if ($kind === 'staff update') $body = \Tests\Support\StaffProfileCommand::body('s-'.$suffix, $body);

            Sanctum::actingAs($this->userWithRole($role));
            $response = $this->json($method, $route, $body);

            if ($role === Role::Owner) {
                $response->assertSuccessful();
            } else {
                $response->assertForbidden();
            }
        }
    }

    public function test_route_binding_resolves_by_legacy_ref_for_every_transitional_model(): void
    {
        $this->branch('b1');
        $this->staffProfile('s1');
        $this->dentistProfile('d1');

        Sanctum::actingAs($this->userWithRole(Role::Owner));

        $this->patchJson('/api/branches/b1', ['city' => 'Updated City'])->assertOk()->assertJsonPath('data.id', 'b1');
        $this->patchJson('/api/staff/s1', \Tests\Support\StaffProfileCommand::body('s1', ['available' => false]))->assertOk()->assertJsonPath('data.id', 's1');
        $this->patchJson('/api/dentists/d1', ['available' => false])->assertOk()->assertJsonPath('data.id', 'd1');
    }

    public function test_unknown_legacy_ref_returns_404(): void
    {
        Sanctum::actingAs($this->userWithRole(Role::Owner));

        $this->patchJson('/api/branches/does-not-exist', ['city' => 'X'])->assertNotFound();
        $this->patchJson('/api/staff/does-not-exist', ['available' => false])->assertNotFound();
        $this->patchJson('/api/dentists/does-not-exist', ['available' => false])->assertNotFound();
    }

    public function test_branch_service_mutation_accepts_legacy_refs_not_bigint_ids(): void
    {
        $branch = $this->branch('b1');
        $service = $this->service('svc1');
        Sanctum::actingAs($this->userWithRole(Role::Owner));

        // Sending the internal bigint id as branch_ref must fail validation (it's not a legacy_ref match).
        $this->postJson('/api/branch-services', ['branch_ref' => (string) $branch->id, 'service_ref' => $service->legacy_ref, 'active' => true])
            ->assertStatus(422);

        $this->postJson('/api/branch-services', ['branch_ref' => $branch->legacy_ref, 'service_ref' => $service->legacy_ref, 'active' => true])
            ->assertSuccessful()
            ->assertJsonPath('data.branch_ref', 'b1')
            ->assertJsonPath('data.service_ref', 'svc1');
    }
}
