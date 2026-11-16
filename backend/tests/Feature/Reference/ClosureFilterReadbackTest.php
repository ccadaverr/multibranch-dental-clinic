<?php

namespace Tests\Feature\Reference;

use App\Models\BranchClosure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class ClosureFilterReadbackTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_global_and_branch_closures_keep_exact_identity_across_readback_rename_and_removal(): void
    {
        $this->setUpSchedulingWorld();
        $this->actingAsUser('owner');
        $global = $this->postJson('/api/branch-closures', ['date' => '2026-10-05', 'reason' => 'Synthetic global closure'])
            ->assertCreated()->assertJsonPath('data.branch', null)->json('data.id');
        $local = $this->postJson('/api/branch-closures', ['date' => '2026-10-06', 'branch_ref' => 'b1', 'reason' => 'Synthetic local closure'])
            ->assertCreated()->assertJsonPath('data.branch.id', 'b1')->json('data.id');
        $this->actingAsUser('staffB1');
        $rows = collect($this->getJson('/api/branch-closures')->assertOk()->json('data'))->keyBy('id');
        self::assertNull($rows[$global]['branch']);
        self::assertSame(['2026-10-06', 'b1', 'Synthetic local closure'], [$rows[$local]['date'], $rows[$local]['branch']['id'], $rows[$local]['reason']]);
        $this->postJson('/api/branch-closures', ['date' => '2026-10-07'])->assertForbidden();
        $this->actingAsUser('owner');
        $this->patchJson('/api/branches/b1', ['name' => 'Synthetic renamed branch'])->assertOk();
        $renamed = collect($this->getJson('/api/branch-closures')->assertOk()->json('data'))->keyBy('id');
        self::assertSame(['b1', 'Synthetic renamed branch'], [$renamed[$local]['branch']['id'], $renamed[$local]['branch']['name']]);
        $this->patchJson('/api/branch-closures/'.$local, ['action' => 'remove'])->assertOk();
        $this->getJson('/api/branch-closures')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $global);
        self::assertSame('removed', BranchClosure::where('public_id', $local)->sole()->status);
        self::assertSame(2, BranchClosure::count(), 'Removal retains both persisted records');
    }
}
