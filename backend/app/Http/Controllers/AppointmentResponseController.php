<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\AppointmentResponse;
use App\Models\PatientGuardian;
use App\Models\SlotOffer;
use App\Models\User;
use App\Services\Appointments\AppointmentCommandException;
use App\Services\Appointments\AppointmentService;
use App\Services\Automations\FillFreedSlots;
use App\Support\ActionLink;
use App\Support\ClinicClock;
use App\Support\CommandActor;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * F1–F3 patient answers.
 *
 * Public (the one-time email links, no sign-in): GET describes what a link is for and whether it still works; POST performs it.
 * "I'll be there" and "On my way" are one click; "I can't make it" and "Take the earlier time" need `confirm: true` (the page
 * asks first, so a mail scanner that opens links changes nothing). A link works once, until its time, and only for the revision
 * of the appointment it was sent for. The answer is shown only the visit's date, time and branch (no service, Dentist or health
 * detail).
 *
 * Signed in (Patient, own records): "On my way" from My visits, the open earlier-time offers, and accepting one.
 */
class AppointmentResponseController extends Controller
{
    public function describe(Request $request): JsonResponse
    {
        $link = ActionLink::parse((string) $request->query('token'));
        if (! $link) return response()->json(['data' => ['state' => 'invalid']], 404);

        return response()->json(['data' => $this->state($link)]);
    }

    public function perform(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'max:600'], 'confirm' => ['sometimes', 'boolean']]);
        $link = ActionLink::parse($data['token']);
        if (! $link) return response()->json(['message' => 'This link is not valid.', 'code' => 'link_invalid'], 404);
        $state = $this->state($link);
        if ($state['state'] !== 'ready' && ! ($link['purpose'] === 'cant_make_it' && $state['state'] === 'done')) return response()->json(['message' => $state['message'], 'code' => 'link_'.$state['state'], 'data' => $state], 422);
        if (in_array($link['purpose'], ['cant_make_it', 'move_up'], true) && ! ($data['confirm'] ?? false)) {
            return response()->json(['message' => 'Please confirm first.', 'code' => 'confirmation_required', 'data' => $state], 422);
        }
        try {
            if ($link['purpose'] === 'cant_make_it') {
                return $this->performCancellation($link);
            }
            if ($link['purpose'] === 'move_up') {
                $offer = SlotOffer::where('public_id', $link['subject'])->with('appointment.patient.user')->firstOrFail();
                app(FillFreedSlots::class)->accept($offer, $offer->appointment->patient->user, 'email', $link['hash']);
            } else {
                $appointment = Appointment::where('public_id', $link['subject'])->firstOrFail();
                AppointmentResponse::create(['appointment_id' => $appointment->id, 'appointment_revision' => $link['revision'],
                    'response' => ['attend' => 'attending', 'on_my_way' => 'on_my_way'][$link['purpose']],
                    'via' => 'email', 'link_hash' => $link['hash']]);
            }
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') return response()->json(['message' => 'This link was already used.', 'code' => 'link_used'], 422);

            throw $e;
        }

        return response()->json(['data' => $this->state($link, done: true)]);
    }

    private function performCancellation(array $link): JsonResponse
    {
        $appointment = Appointment::where('public_id', $link['subject'])->firstOrFail();
        $actor = $this->cancellationActor($appointment, $link);
        abort_unless($actor, 403, 'Sign in to cancel this appointment or contact the clinic.');

        $replay = CommandActor::run($actor, function (User $current) use ($appointment, $link) {
            $locked = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            abort_unless($this->cancellationActor($locked, $link)?->id === $current->id, 403);
            if ($current->patient?->id !== $locked->patient_id) {
                abort_unless(PatientGuardian::where('guardian_patient_id', $current->patient?->id)
                    ->where('dependent_patient_id', $locked->patient_id)->where('status', 'active')
                    ->lockForUpdate()->first(), 403);
            }
            if (AppointmentResponse::where('link_hash', $link['hash'])->exists()) {
                return true;
            }
            app(AppointmentService::class)->cancel($current, $locked, [
                'expected_revision' => $link['revision'], 'source' => 'cant_make_it',
            ], null);
            AppointmentResponse::create([
                'appointment_id' => $locked->id, 'appointment_revision' => $link['revision'],
                'response' => 'cant_make_it', 'via' => 'email', 'link_hash' => $link['hash'],
            ]);

            return false;
        });
        if ($replay) {
            app(AppointmentService::class)->reconcileCancellationRefund($appointment->fresh(), $actor);
        }

        return response()->json(['data' => $this->state($link, done: true)]);
    }

    private function cancellationActor(Appointment $appointment, array $link): ?User
    {
        $contact = $appointment->patient?->contactUser();
        if (! $contact || $contact->role !== Role::Patient || $contact->account_status !== 'Active'
            || $contact->public_id !== $link['recipient'] || $contact->auth_version !== $link['recipient_version']
            || ClinicClock::now()->greaterThanOrEqualTo($link['expires_at'])
            || ! Gate::forUser($contact)->allows('cancel', $appointment)) {
            return null;
        }

        return $contact;
    }

    /** Patient, signed in: "On my way" for today's visit (the front desk sees it on the Check-In page). */
    public function onMyWay(Request $request, Appointment $appointment): JsonResponse
    {
        abort_unless($appointment->patient_id === $request->user()->patient?->id, 404);
        if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || ClinicClock::local($appointment->starts_at)->toDateString() !== ClinicClock::today()) {
            throw AppointmentCommandException::rule('not_today', 'This works only for today’s visit before you check in.', 'appointment');
        }
        AppointmentResponse::firstOrCreate(['appointment_id' => $appointment->id, 'appointment_revision' => $appointment->revision, 'response' => 'on_my_way', 'via' => 'app']);

        return response()->json(['data' => ['response' => 'on_my_way']]);
    }

    /** Patient: open "an earlier time is available" offers for their own appointments. */
    public function offersMine(Request $request): JsonResponse
    {
        $patientId = $request->user()->patient?->id ?? 0;
        $offers = SlotOffer::where('status', 'offered')->whereHas('appointment', fn ($q) => $q->where('patient_id', $patientId))
            ->whereHas('opening', fn ($q) => $q->where('status', 'open')->where('starts_at', '>', now()->toIso8601String()))
            ->with(['opening', 'appointment.branch'])->orderBy('offered_at')->get();

        return response()->json(['data' => $offers->map(fn (SlotOffer $o) => [
            'id' => $o->public_id, 'appointment_id' => $o->appointment->public_id, 'branch' => $o->appointment->branch?->name,
            'new_starts_at' => ClinicClock::local($o->opening->starts_at)->toIso8601String(), 'current_starts_at' => ClinicClock::local($o->appointment->starts_at)->toIso8601String(),
        ])->values()]);
    }

    public function acceptOffer(Request $request, SlotOffer $slotOffer): JsonResponse
    {
        abort_unless($slotOffer->appointment?->patient_id === $request->user()->patient?->id, 404);
        $moved = app(FillFreedSlots::class)->accept($slotOffer, $request->user(), 'app');

        return response()->json(['data' => ['appointment_id' => $moved->public_id, 'starts_at' => ClinicClock::local($moved->starts_at)->toIso8601String()]]);
    }

    /** What a link is for and whether it still works: ready, used, expired, out_of_date or taken. */
    private function state(array $link, bool $done = false): array
    {
        $now = ClinicClock::now();
        $used = AppointmentResponse::where('link_hash', $link['hash'])->exists();
        if ($link['purpose'] === 'move_up') {
            $offer = SlotOffer::where('public_id', $link['subject'])->with(['opening', 'appointment.branch'])->first();
            if (! $offer) return ['state' => 'invalid', 'purpose' => 'move_up', 'message' => 'This link is not valid.'];
            $a = $offer->appointment;
            $base = ['purpose' => 'move_up', 'appointment' => $this->view($a), 'new_time' => $this->when($offer->opening->starts_at)];
            if ($done || $used) return $base + ['state' => $done ? 'done' : 'used', 'message' => $done ? 'Done. Your appointment was moved to the earlier time.' : 'This link was already used.'];
            if ($offer->opening->status !== 'open' || $offer->status !== 'offered') return $base + ['state' => 'taken', 'message' => 'Another patient took this time first. Your appointment stays as it was.'];
            if ($now->greaterThanOrEqualTo($link['expires_at'])) return $base + ['state' => 'expired', 'message' => 'This earlier time has passed. Your appointment stays as it was.'];
            if ($a->revision !== $link['revision'] || ! in_array($a->status, ['Pending', 'Confirmed'], true)) return $base + ['state' => 'out_of_date', 'message' => 'Your appointment changed after this offer was sent.'];

            return $base + ['state' => 'ready', 'message' => null];
        }
        $a = Appointment::where('public_id', $link['subject'])->with('branch')->first();
        if (! $a) return ['state' => 'invalid', 'purpose' => $link['purpose'], 'message' => 'This link is not valid.'];
        $base = ['purpose' => $link['purpose'], 'appointment' => $this->view($a)];
        if ($link['purpose'] === 'cant_make_it') {
            if ($now->greaterThanOrEqualTo($link['expires_at'])) {
                return ['state' => 'expired', 'purpose' => 'cant_make_it', 'message' => 'This link has expired.'];
            }
            if (! $this->cancellationActor($a, $link)) {
                return ['state' => 'invalid', 'purpose' => 'cant_make_it', 'message' => 'Sign in to cancel this appointment or contact the clinic.'];
            }
            if ($used && $a->status === 'Cancelled') {
                $refund = $a->cancellationRefund();
                return $base + ['state' => 'done', 'message' => 'Your appointment is cancelled.', 'cancellation_refund' => $refund];
            }
        }
        if ($done) return $base + ['state' => 'done', 'message' => ['attend' => 'Thank you! The clinic knows you’ll be there.', 'on_my_way' => 'Thank you! The front desk knows you’re on your way.',
            ][$link['purpose']]];
        if ($used) return $base + ['state' => 'used', 'message' => 'This link was already used.'];
        if ($now->greaterThanOrEqualTo($link['expires_at'])) return $base + ['state' => 'expired', 'message' => 'This link has expired.'];
        if ($a->revision !== $link['revision'] || ! in_array($a->status, ['Pending', 'Confirmed'], true) || $a->visit()->exists()) {
            return $base + ['state' => 'out_of_date', 'message' => $a->status === 'Cancelled' ? 'This appointment was already cancelled.' : 'This appointment changed after the email was sent. Please check My visits.'];
        }

        return $base + ['state' => 'ready', 'message' => null];
    }

    private function view(?Appointment $a): ?array
    {
        return $a ? ['code' => $a->appointment_code, 'when' => $this->when($a->starts_at), 'branch' => $a->branch?->name, 'address' => $a->branch?->address, 'phone' => $a->branch?->phone] : null;
    }

    private function when($instant): string
    {
        return ClinicClock::local($instant)->format('l, F j, Y \a\t g:i A');
    }
}
