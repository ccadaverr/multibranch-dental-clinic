<?php

namespace App\Services\Inquiries;

use App\Http\Resources\InquiryResource;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\CommandKey;
use App\Models\Inquiry;
use App\Models\InquiryHistory;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Services\Visits\VisitCommandException;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

// M16 named commands (Staff only; Idempotency-Key required). No generic status update exists.
//   create:  a Staff member in the branch's authorization scope records an inquiry they received through a channel THEY report.
//            It is assigned to that Staff member (no routing rule exists) and linked to no Patient.
//   respond: records that Staff responded OUTSIDE this system. Nothing is sent, delivered or synchronized by this command.
//   close:   ends the inquiry. Closed and Converted are final.
//   convert: links an EXISTING, non-cancelled appointment of the inquiry's branch (and so that appointment's Patient). It creates no
//            appointment, no Patient, no conversation (M17 owns ongoing conversations) and no marketing contact.
final class InquiryService
{
    private const ATTEMPTS = 3;

    public function create(User $actor, Branch $branch, string $source, string $name, ?string $contact, string $topic, string $key): JsonResponse
    {
        $payload = ['branch' => $branch->id, 'source' => $source, 'name' => $name, 'contact' => $contact, 'topic' => $topic];

        return $this->idempotent($actor, $key, 'inquiry.create', $payload, function () use ($actor, $branch, $source, $name, $contact, $topic) {
            $this->authorizeBranch($actor, $branch->id);
            $now = ClinicClock::now();
            $inquiry = Inquiry::create([
                'source' => $source, 'capture_method' => 'staff_manual', 'contact_name' => $name, 'contact_detail' => $contact, 'topic' => $topic,
                'branch_id' => $branch->id, 'assigned_user_id' => $actor->id, 'created_by_user_id' => $actor->id,
                'status' => 'Open', 'revision' => 1, 'received_at' => $now,
            ]);
            $this->history($inquiry, $actor, 'inquiry.captured', null);

            return [$inquiry, 201];
        });
    }

    public function transition(User $actor, Inquiry $inquiry, string $to, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['inquiry' => $inquiry->id, 'to' => $to, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'inquiry.'.strtolower($to === 'Responded' ? 'respond' : 'close'), $payload, function () use ($actor, $inquiry, $to, $expectedRevision) {
            $current = $this->lock($actor, $inquiry);
            if ($current->status === $to) {
                return [$current, 200];
            }
            if (in_array($current->status, ['Closed', 'Converted'], true)) {
                throw VisitCommandException::rule('inquiry_final', "This inquiry is already {$current->status} and cannot change.", 'status');
            }
            if ($current->revision !== $expectedRevision) {
                throw self::stale();
            }
            $from = $current->status;
            $now = ClinicClock::now();
            $current->update(['status' => $to, 'revision' => $current->revision + 1] + ($to === 'Responded' ? ['responded_at' => $now] : ['closed_at' => $now]));
            $this->history($current, $actor, $to === 'Responded' ? 'inquiry.responded' : 'inquiry.closed', $from);

            return [$current, 200];
        });
    }

    public function convert(User $actor, Inquiry $inquiry, string $appointmentPublicId, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['inquiry' => $inquiry->id, 'appointment' => $appointmentPublicId, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'inquiry.convert', $payload, function () use ($actor, $inquiry, $appointmentPublicId, $expectedRevision) {
            $current = $this->lock($actor, $inquiry);
            $appointment = Appointment::where('public_id', strtolower($appointmentPublicId))->lockForUpdate()->first();
            if ($current->appointment_id !== null) {
                if ($appointment && $current->appointment_id === $appointment->id) {
                    return [$current, 200];
                }
                throw VisitCommandException::rule('inquiry_already_linked', 'This inquiry is already linked to another appointment.', 'appointment_id');
            }
            if (! $appointment || $appointment->branch_id !== $current->branch_id) {
                throw VisitCommandException::rule('appointment_not_linkable', 'Choose an existing appointment in this inquiry’s branch.', 'appointment_id');
            }
            if ($appointment->status === 'Cancelled') {
                throw VisitCommandException::rule('appointment_cancelled', 'A cancelled appointment cannot be linked.', 'appointment_id');
            }
            if (! in_array($current->status, ['Open', 'Responded'], true)) {
                throw VisitCommandException::rule('inquiry_final', "Only an open or responded inquiry can be linked; this one is {$current->status}.", 'status');
            }
            if ($current->revision !== $expectedRevision) {
                throw self::stale();
            }
            $from = $current->status;
            $current->update(['status' => 'Converted', 'revision' => $current->revision + 1, 'appointment_id' => $appointment->id, 'patient_id' => $appointment->patient_id, 'converted_at' => ClinicClock::now()]);
            $this->history($current, $actor, 'inquiry.linked_to_appointment', $from);
            // Minimal M22 event (identifiers and the state change only): a Patient link is the one M16 action that touches identity.
            app(AuditService::class)->record([
                'action' => 'inquiry.linked_to_patient', 'category' => 'general', 'severity' => 'info', 'actor' => $actor, 'target' => $current, 'branch_id' => $current->branch_id,
                'payload' => ['appointment' => $appointment->public_id, 'from_status' => $from, 'to_status' => 'Converted', 'revision' => $current->revision],
            ]);

            return [$current, 200];
        });
    }

    /** Locks the inquiry and re-checks, under the lock, that the actor is still its assignee with branch authorization. */
    private function lock(User $actor, Inquiry $inquiry): Inquiry
    {
        $current = Inquiry::whereKey($inquiry->id)->lockForUpdate()->firstOrFail();
        if (! $current->visibleToUser($actor)) {
            throw new VisitCommandException(403, 'forbidden', 'This inquiry is outside your scope.');
        }

        return $current;
    }

    private function authorizeBranch(User $actor, int $branchId): void
    {
        if (! UserBranchScope::where('user_id', $actor->id)->where('branch_id', $branchId)->exists()) {
            throw new VisitCommandException(403, 'forbidden', 'This branch is outside your access.');
        }
    }

    private function history(Inquiry $inquiry, User $actor, string $event, ?string $from): void
    {
        InquiryHistory::create(['inquiry_id' => $inquiry->id, 'event' => $event, 'from_status' => $from, 'to_status' => $inquiry->status, 'revision' => $inquiry->revision,
            'actor_user_id' => $actor->id, 'actor_role' => $actor->role->value, 'occurred_at' => ClinicClock::now()]);
    }

    private static function stale(): VisitCommandException
    {
        return new VisitCommandException(409, 'stale_revision', 'This inquiry changed after it was opened. Reload it before trying again.');
    }

    private function idempotent(User $actor, string $key, string $command, array $payload, Closure $work): JsonResponse
    {
        return DB::transaction(function () use ($actor, $key, $command, $payload, $work) {
            // Match personnel assignment writers: profile gate before linked account.
            $profile = StaffProfile::where('person_id', $actor->person_id)->lockForUpdate()->first();
            $current = User::whereKey($actor->id)->lock('for no key update')->first();
            if (! $current || $current->role->value !== 'staff' || $current->account_status !== 'Active'
                || $current->auth_version !== $actor->auth_version || $current->person_id !== $actor->person_id) {
                throw new VisitCommandException(403, 'forbidden', 'Your Staff session changed. Refresh and try again.');
            }
            if (StaffProfile::where('person_id', $current->person_id)->value('id') !== $profile?->id) {
                throw new VisitCommandException(403, 'forbidden', 'Your Staff assignment changed. Refresh and try again.');
            }
            if ($command === 'inquiry.create') {
                $branchId = (int) $payload['branch'];
                if ($profile?->branch_id !== null && (int) $profile->branch_id !== $branchId) {
                    throw new VisitCommandException(403, 'forbidden', 'This branch is outside your active branch assignment.');
                }
                $this->authorizeBranch($current, $branchId);
            } else {
                $inquiry = Inquiry::find($payload['inquiry']);
                if (! $inquiry || ! $inquiry->visibleToUser($current)) {
                    throw new VisitCommandException(403, 'forbidden', 'This inquiry is outside your scope.');
                }
            }
            // Authority is checked before replay, not only before first execution.
            return IdempotentCommand::run(
                CommandKey::class, $current, $key, $command, $payload,
                function () use ($work) {
                    [$inquiry, $status] = $work();
                    $body = (new InquiryResource($inquiry->fresh(['branch', 'assignee.person', 'patient.person', 'appointment'])))->response()->getData(true);

                    return [$body, $status];
                },
                fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
                function (\Illuminate\Database\QueryException $e) {
                    if (in_array($e->getCode(), ['40P01', '40001'], true)) {
                        throw new VisitCommandException(409, 'conflict', 'Another request changed this inquiry at the same time. Reload and try again.');
                    }
                },
                self::ATTEMPTS,
            );
        });
    }
}
