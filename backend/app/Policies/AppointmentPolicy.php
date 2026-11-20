<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\User;
use App\Models\UserBranchScope;

// M6 authorization (mirrors src/contracts.js inScope). Patient: own appointments only. Staff: only branches in the
// account's authorization scopes (user_branch_scopes; zero, one or many) — never inferred from operational
// assignment. Dentist: read-only view of appointments assigned to them. Owner: all branches. Active-account checks
// happen earlier in the `role:` middleware.
class AppointmentPolicy
{
    public function view(User $user, Appointment $appointment): bool
    {
        return match ($user->role) {
            Role::Owner => true,
            // A patient sees their own appointments and their active dependents' (guardian, intake R2-12).
            Role::Patient => $user->patient !== null && in_array($appointment->patient_id, \App\Services\Intake\Guardianship::patientIdsFor($user), true),
            Role::Staff => $this->staffScope($user, $appointment->branch_id),
            Role::Dentist => $appointment->dentist?->person_id === $user->person_id,
        };
    }

    /** Create an appointment (or search availability) at this branch. */
    public function book(User $user, Branch $branch): bool
    {
        return match ($user->role) {
            Role::Owner => true,
            Role::Patient => $user->patient !== null,
            Role::Staff => $this->staffScope($user, $branch->id),
            Role::Dentist => false,
        };
    }

    public function reschedule(User $user, Appointment $appointment): bool
    {
        return $user->role !== Role::Dentist && $this->view($user, $appointment);
    }

    public function cancel(User $user, Appointment $appointment): bool
    {
        return $user->role !== Role::Dentist && $this->view($user, $appointment);
    }

    /** Financial provider action: never available to Patients or Dentists. */
    public function refundBookingPayment(User $user, Appointment $appointment): bool
    {
        return in_array($user->role, [Role::Staff, Role::Owner], true) && $this->view($user, $appointment);
    }

    /**
     * Appointment-only transitions: the pre-arrival No-show is a front-desk action — in-scope Staff, or Owner under the
     * documented Phase 1 administrative exception. Check-In and treatment start/completion are Visit commands
     * (VisitPolicy).
     */
    public function transition(User $user, Appointment $appointment, string $command): bool
    {
        return in_array($command, ['no-show', 'confirm'], true) && in_array($user->role, [Role::Staff, Role::Owner], true) && $this->view($user, $appointment);
    }

    private function staffScope(User $user, int $branchId): bool
    {
        return UserBranchScope::where('user_id', $user->id)->where('branch_id', $branchId)->exists();
    }
}
