<?php

namespace Tests\Unit;

use App\Services\Scheduling\StaffShiftRevision;
use PHPUnit\Framework\TestCase;

class StaffShiftRevisionTest extends TestCase
{
    public function test_revisions_compare_complete_persisted_state_and_change_sequence(): void
    {
        $state = ['shift_start' => '09:00:00', 'shift_end' => '17:00:00', 'branch_id' => 1];
        $revision = StaffShiftRevision::digest($state, 100);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $revision);
        $this->assertSame($revision, StaffShiftRevision::digest(array_reverse($state, true), 100));
        $this->assertSame($revision, StaffShiftRevision::combine(StaffShiftRevision::stateDigest($state), 100));
        $this->assertNotSame($revision, StaffShiftRevision::digest($state, 101), 'A reverted change still has a new sequence.');
        foreach ($state as $field => $value) {
            $changed = $state;
            $changed[$field] = $field === 'branch_id' ? 2 : '18:00:00';
            $this->assertNotSame($revision, StaffShiftRevision::digest($changed, 100));
        }
    }
}
