<?php

namespace App\Services\Followups;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\Treatment;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Appointments\AppointmentCommandException;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Gate;

/**
 * M20: the follow-up task lifecycle the rest of the system calls into.
 *  - fromTreatment(): a completed treatment that asks for a follow-up gets one task (once per treatment), due on the recommended
 *    date (today when none was given), for the branch front desk, with the treatment's first service preselected for booking.
 *  - booked(): an appointment booked for the patient marks their oldest open task Booked (the same branch first).
 *  - cancelled(): cancelling that appointment opens the task again.
 * Audit entries name the task, never its reason.
 */
final class Followups
{
    public static function fromTreatment(Treatment $t): ?FollowupTask
    {
        if (! $t->followup_required || $t->status !== 'Completed') return null;
        $t->loadMissing(['visit', 'procedures']);
        if (! $t->visit) return null;
        try {
            // A savepoint: a duplicate (already created) never aborts the completing treatment's transaction.
            $task = \Illuminate\Support\Facades\DB::transaction(fn () => FollowupTask::create(['patient_id' => $t->visit->patient_id, 'branch_id' => $t->visit->branch_id, 'treatment_id' => $t->id,
                'service_id' => $t->procedures->first()?->service_id ?? $t->visit->requested_service_id, 'dentist_profile_id' => $t->dentist_profile_id,
                'reason' => trim((string) ($t->followup_reason ?: 'Follow-up visit')), 'due_on' => $t->followup_recommended_date ? substr((string) $t->getRawOriginal('followup_recommended_date'), 0, 10) : ClinicClock::today(),
                'source' => 'treatment', 'status' => 'Open', 'created_by_user_id' => $t->updated_by_user_id]));
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') return FollowupTask::where('treatment_id', $t->id)->where('source', 'treatment')->first(); // already created

            throw $e;
        }
        app(AuditService::class)->record(['action' => 'followup.created', 'category' => 'clinical', 'severity' => 'info', 'actor' => null, 'target' => $task->patient,
            'payload' => ['task' => $task->public_id, 'source' => 'treatment', 'due_on' => $task->dueOn()]]);

        return $task;
    }

    public static function booked(Appointment $a): ?FollowupTask
    {
        if (! in_array($a->status, Appointment::ACTIVE_STATUSES, true)) return null;
        $task = FollowupTask::where('patient_id', $a->patient_id)->whereIn('status', FollowupTask::OPEN)
            ->orderByRaw('case when branch_id = ? then 0 else 1 end', [$a->branch_id])->orderBy('due_on')->orderBy('id')->lockForUpdate()->first();
        if (! $task) return null;
        $task->update(['status' => 'Booked', 'appointment_id' => $a->id, 'booked_at' => now(), 'revision' => $task->revision + 1]);
        app(AuditService::class)->record(['action' => 'followup.booked', 'category' => 'clinical', 'severity' => 'info', 'actor' => null, 'target' => $task->patient,
            'payload' => ['task' => $task->public_id, 'appointment' => $a->public_id]]);

        return $task;
    }

    /** Current authority before replay; repeat with a row lock inside a NEW command's transaction. */
    public static function selectedForBooking(User $actor, Branch $branch, string $publicId, bool $lock = false): FollowupTask
    {
        $current = $actor->fresh();
        abort_unless($current && $current->account_status === 'Active' && $current->role === Role::Staff
            && $current->auth_version === $actor->auth_version && $current->person, 403);
        Gate::forUser($current)->authorize('book', [Appointment::class, $branch]);

        // Scope the lookup itself: absent and out-of-scope identities share the same 404.
        $query = FollowupTask::where('public_id', $publicId)->whereIn('branch_id',
            UserBranchScope::where('user_id', $current->id)->select('branch_id'));
        if ($lock) $query->lockForUpdate();

        return $query->firstOrFail();
    }

    /** An early snapshot may refuse promptly; recheck the locked record before linking. Always run after replay. */
    public static function validateSelectedBooking(FollowupTask $task, Patient $patient, Branch $branch, int $expectedRevision): void
    {
        if ((int) $task->patient_id !== (int) $patient->id) {
            throw AppointmentCommandException::rule('followup_patient_mismatch', 'The selected follow-up does not belong to the appointment Patient.', 'followup_task_id');
        }
        if ((int) $task->branch_id !== (int) $branch->id) {
            throw AppointmentCommandException::rule('followup_branch_mismatch', 'Book the selected follow-up at its own branch.', 'followup_task_id');
        }
        if ($task->revision !== $expectedRevision || ! in_array($task->status, FollowupTask::OPEN, true) || $task->appointment_id !== null) {
            throw new AppointmentCommandException(409, 'followup_conflict', 'The selected follow-up changed or is no longer available for booking. Reload it before trying again.');
        }
    }

    /** The appointment is provisional; the caller holds the task lock through linkage, proof serialization and commit. */
    public static function bookSelected(FollowupTask $task, Appointment $appointment, User $actor): array
    {
        $task->update(['status' => 'Booked', 'appointment_id' => $appointment->id, 'booked_at' => now(),
            'revision' => $task->revision + 1, 'updated_by_user_id' => $actor->id]);
        $task->refresh();
        app(AuditService::class)->record(['action' => 'followup.booked', 'category' => 'clinical', 'severity' => 'info', 'actor' => $actor, 'target' => $task->patient,
            'payload' => ['task' => $task->public_id, 'appointment' => $appointment->public_id]]);

        return ['task_id' => $task->public_id, 'appointment_id' => $appointment->public_id,
            'status' => $task->status, 'revision' => $task->revision];
    }

    public static function cancelled(Appointment $a): void
    {
        foreach (FollowupTask::where('appointment_id', $a->id)->where('status', 'Booked')->get() as $task) {
            $task->update(['status' => 'Open', 'appointment_id' => null, 'booked_at' => null, 'revision' => $task->revision + 1]);
            app(AuditService::class)->record(['action' => 'followup.reopened', 'category' => 'clinical', 'severity' => 'info', 'actor' => null, 'target' => $task->patient,
                'payload' => ['task' => $task->public_id, 'appointment' => $a->public_id]]);
        }
    }
}
