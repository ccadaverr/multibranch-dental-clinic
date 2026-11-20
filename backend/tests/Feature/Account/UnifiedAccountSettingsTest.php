<?php

namespace Tests\Feature\Account;

use App\Enums\Role;
use PHPUnit\Framework\Attributes\DataProvider;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Requires a verified isolated test database; never run against a populated clinic database. */
final class UnifiedAccountSettingsTest extends TestCase
{
    use RefreshDatabase;

    #[DataProvider('roles')]
    public function test_every_role_can_update_its_own_name_with_an_owner_readable_audit_event(string $role): void
    {
        $actor = User::factory()->role(Role::from($role))->create();
        $other = User::factory()->role(Role::Patient)->create();
        $before = $actor->person;
        $this->actingAs($actor);

        $this->patchJson('/api/me/name', [
            'first_name' => '  Morgan ', 'last_name' => 'Roxas',
            'expected_first_name' => $before->first_name, 'expected_last_name' => $before->last_name,
            'person_id' => $other->person_id,
        ])->assertOk()->assertJsonPath('data.name', 'Morgan Roxas')
          ->assertJsonPath('data.first_name', 'Morgan')->assertJsonPath('data.last_name', 'Roxas');

        $this->assertSame('Morgan Roxas', $actor->fresh()->name());
        $this->assertNotSame('Morgan Roxas', $other->fresh()->name());
        $log = AuditLog::query()->where('action', 'account.profile_name.updated')->firstOrFail();
        $this->assertSame($actor->id, $log->actor_user_id);
        $this->assertSame($actor->public_id, $log->auditable_public_id);
        $this->assertSame($before->fullName(), $log->payload['previous_name']);
        $this->assertSame('Morgan Roxas', $log->payload['new_name']);

        // The Owner can find the change through the real, authenticated Audit Trail endpoint.
        $owner = User::factory()->role(Role::Owner)->create();
        $this->actingAs($owner);
        $this->getJson('/api/audit-logs?action=account.profile_name.updated')
            ->assertOk()->assertJsonFragment(['action' => 'account.profile_name.updated']);
        $this->actingAs($actor);

        // Repeated identical updates must not invent duplicate name-change history.
        $this->patchJson('/api/me/name', [
            'first_name' => 'Morgan', 'last_name' => 'Roxas',
            'expected_first_name' => 'Morgan', 'expected_last_name' => 'Roxas',
        ])->assertOk();
        $this->assertSame(1, AuditLog::query()->where('action', 'account.profile_name.updated')->count());
        $this->patchJson('/api/me/name', [
            'first_name' => 'Stale', 'last_name' => 'Name',
            'expected_first_name' => $before->first_name, 'expected_last_name' => $before->last_name,
        ])->assertStatus(409);
        $this->assertSame('Morgan Roxas', $actor->fresh()->name());
    }

    public static function roles(): array
    {
        return [['patient'], ['staff'], ['dentist'], ['owner']];
    }

    public static function workforceRoles(): array
    {
        return [['staff'], ['dentist'], ['owner']];
    }

    #[DataProvider('workforceRoles')]
    public function test_password_change_requires_current_password_and_revokes_existing_credentials(string $role): void
    {
        $actor = User::factory()->role(Role::from($role))->create(['password' => 'Passw0rd!']);
        $this->actingAs($actor);
        $before = $actor->auth_version;
        $this->postJson('/api/me/password/change', [
            'current_password' => 'Incorrect1', 'password' => 'NewPassw0rd!', 'password_confirmation' => 'NewPassw0rd!',
        ])->assertStatus(422)->assertJsonValidationErrors('current_password');
        $this->assertTrue(Hash::check('Passw0rd!', $actor->fresh()->password));

        $this->postJson('/api/me/password/change', [
            'current_password' => 'Passw0rd!', 'password' => 'NewPassw0rd!', 'password_confirmation' => 'NewPassw0rd!',
        ])->assertOk()->assertJsonPath('data.sign_in_required', true);
        $this->assertTrue(Hash::check('NewPassw0rd!', $actor->fresh()->password));
        $this->assertGreaterThan($before, $actor->fresh()->auth_version);
        $log = AuditLog::query()->where('action', 'account.password.changed')->firstOrFail();
        $this->assertArrayNotHasKey('password', $log->payload);
        $this->assertArrayNotHasKey('current_password', $log->payload);
    }

    public function test_patient_password_change_cannot_bypass_the_existing_email_code_policy(): void
    {
        $patient = User::factory()->role(Role::Patient)->create(['password' => 'Passw0rd!']);
        $this->actingAs($patient);
        $payload = [
            'current_password' => 'Passw0rd!',
            'password' => 'NewPassw0rd!',
            'password_confirmation' => 'NewPassw0rd!',
        ];
        $this->postJson('/api/me/password/change', $payload)->assertStatus(403);
        $this->postJson('/api/me/password', $payload)->assertStatus(422)->assertJsonValidationErrors('otp');
        $this->assertTrue(Hash::check('Passw0rd!', $patient->fresh()->password));
    }

    #[DataProvider('roles')]
    public function test_photo_is_private_to_current_user_and_rejects_invalid_file(string $role): void
    {
        Storage::fake('local');
        $actor = User::factory()->role(Role::from($role))->create();
        $other = User::factory()->role(Role::Patient)->create();
        $this->getJson('/api/me/photo')->assertStatus(401);
        $this->actingAs($actor);
        $this->post('/api/me/photo', ['photo' => UploadedFile::fake()->create('unsafe.txt', 3, 'text/plain')])
            ->assertStatus(422);
        // Valid 1x1 PNG without relying on GD being installed on the test host.
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/mXcAAAAASUVORK5CYII=');
        $path = tempnam(sys_get_temp_dir(), 'account-image-');
        file_put_contents($path, $png);
        try {
            $this->post('/api/me/photo', ['photo' => new UploadedFile($path, 'photo.png', 'image/png', null, true)])
                ->assertOk()->assertJsonPath('data.updated', true);
        } finally {
            @unlink($path);
        }
        $this->get('/api/me/photo')->assertOk()->assertHeader('Cache-Control', 'private, no-store')->assertHeader('Content-Type', 'image/png');
        $this->actingAs($other);
        $this->get('/api/me/photo')->assertNotFound();
        $this->actingAs($actor);
        $this->deleteJson('/api/me/photo')->assertOk();
        $this->get('/api/me/photo')->assertNotFound();
        $this->assertSame(1, AuditLog::query()->where('action', 'account.profile_photo.updated')->count());
        $this->assertSame(1, AuditLog::query()->where('action', 'account.profile_photo.removed')->count());
    }

    public function test_inactive_accounts_cannot_change_name_or_photo_or_password(): void
    {
        $actor = User::factory()->create(['account_status' => 'Inactive']);
        $this->actingAs($actor);
        $this->patchJson('/api/me/name', [
            'first_name' => 'Blocked', 'last_name' => 'Account',
            'expected_first_name' => $actor->person->first_name,
            'expected_last_name' => $actor->person->last_name,
        ])->assertStatus(403);
        $this->get('/api/me/photo')->assertStatus(403);
        $this->postJson('/api/me/password/change', [
            'current_password' => 'password', 'password' => 'NewPassw0rd!', 'password_confirmation' => 'NewPassw0rd!',
        ])->assertStatus(403);
    }
}
