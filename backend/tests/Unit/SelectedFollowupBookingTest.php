<?php

namespace Tests\Unit;

use App\Models\Branch;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Services\Appointments\AppointmentCommandException;
use App\Services\Followups\Followups;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Production selection invariants on unsaved models. Row locking and persistence require PostgreSQL acceptance. */
final class SelectedFollowupBookingTest extends TestCase
{
    public static function states(): array
    {
        return [
            'Open' => [['status' => 'Open'], null],
            'Contacted' => [['status' => 'Contacted'], null],
            'stale' => [['revision' => 8], 'followup_conflict'],
            'Closed' => [['status' => 'Closed'], 'followup_conflict'],
            'Booked' => [['status' => 'Booked', 'appointment_id' => 99], 'followup_conflict'],
            'active but already linked' => [['appointment_id' => 99], 'followup_conflict'],
            'wrong patient' => [['patient_id' => 11], 'followup_patient_mismatch'],
            'wrong branch' => [['branch_id' => 21], 'followup_branch_mismatch'],
        ];
    }

    #[DataProvider('states')]
    public function test_locked_selection_invariants(array $overrides, ?string $code): void
    {
        $task = new FollowupTask();
        $task->setRawAttributes($overrides + ['patient_id' => 10, 'branch_id' => 20, 'status' => 'Open', 'revision' => 7, 'appointment_id' => null]);
        $patient = new Patient();
        $patient->setRawAttributes(['id' => 10]);
        $branch = new Branch();
        $branch->setRawAttributes(['id' => 20]);
        try {
            Followups::validateSelectedBooking($task, $patient, $branch, 7);
            self::assertNull($code, 'An invalid selection must be refused.');
        } catch (AppointmentCommandException $e) {
            self::assertSame($code, $e->errorCode);
            self::assertSame(str_ends_with($code, '_mismatch') ? 422 : 409, $e->status);
            self::assertStringNotContainsString('reason', $e->getMessage());
        }
        self::assertFalse($task->exists, 'Validation must not save or create any model.');
    }
}
