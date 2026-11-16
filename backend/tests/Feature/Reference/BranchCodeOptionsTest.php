<?php

namespace Tests\Feature\Reference;

use App\Enums\Role;
use App\Models\{AuditLog, Branch, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BranchCodeOptionsTest extends TestCase
{
    use RefreshDatabase;

    private function branch(string $code = 'BRC-A'): Branch
    {
        Sanctum::actingAs(User::factory()->role(Role::Owner)->create());
        return Branch::create(['legacy_ref' => 'b1', 'branch_code' => $code, 'name' => 'Synthetic branch',
            'city' => 'Synthetic city', 'address' => 'Synthetic address', 'open_time' => '08:00', 'close_time' => '17:00']);
    }

    public function test_invalid_codes_never_change_the_branch_or_create_an_audit_receipt(): void
    {
        $branch = $this->branch();
        $before = $branch->fresh()->getAttributes();
        $audits = AuditLog::count();
        foreach (['NOT-AN-ALLOWED-CODE', 'brc-a', '', null, 42, ['BRC-C']] as $code) {
            $this->patchJson('/api/branches/b1', ['branch_code' => $code])->assertUnprocessable()->assertJsonValidationErrors('branch_code');
            self::assertSame($before, $branch->fresh()->getAttributes());
            self::assertSame($audits, AuditLog::count());
        }
    }

    public function test_existing_request_trimming_returns_the_canonical_allowed_code(): void
    {
        $branch = $this->branch();
        $this->patchJson('/api/branches/b1', ['branch_code' => ' BRC-C '])->assertOk()->assertJsonPath('data.branch_code', 'BRC-C');
        self::assertSame('BRC-C', $branch->fresh()->branch_code);
    }

    public function test_every_catalog_option_round_trips_with_the_same_branch_identity(): void
    {
        $branch = $this->branch();
        $catalog = json_decode(file_get_contents(resource_path('branch-code-options.json')), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame($catalog, config('branch_codes'));
        self::assertNotEmpty($catalog);
        self::assertSame($catalog, array_values(array_unique($catalog)));
        foreach ($catalog as $code) {
            $this->patchJson('/api/branches/b1', ['branch_code' => $code])->assertOk()
                ->assertJsonPath('data.id', 'b1')->assertJsonPath('data.public_id', $branch->public_id)->assertJsonPath('data.branch_code', $code);
            $this->getJson('/api/branches')->assertOk()->assertJsonPath('data.0.branch_code', $code);
            self::assertSame($code, $branch->fresh()->branch_code);
        }
    }

    public function test_only_its_unchanged_existing_legacy_code_remains_compatible(): void
    {
        $branch = $this->branch('EXISTING-LEGACY');
        $this->patchJson('/api/branches/b1', ['branch_code' => 'EXISTING-LEGACY', 'city' => 'Synthetic updated city'])
            ->assertOk()->assertJsonPath('data.branch_code', 'EXISTING-LEGACY');
        $this->patchJson('/api/branches/b1', ['branch_code' => 'OTHER-LEGACY'])->assertUnprocessable();
        $this->patchJson('/api/branches/b1', ['branch_code' => 'BRC-C'])->assertOk()->assertJsonPath('data.branch_code', 'BRC-C');
        $this->patchJson('/api/branches/b1', ['branch_code' => 'EXISTING-LEGACY'])->assertUnprocessable();
        self::assertSame('BRC-C', $branch->fresh()->branch_code);
    }
}
