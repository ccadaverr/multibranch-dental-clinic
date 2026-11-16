<?php

namespace App\Services\Intake;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\IntakeSubmission;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Service;
use App\Models\User;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Visits\VisitService;
use App\Support\ClinicClock;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Counter registration (R2-03: "new patients fill in their information on paper, then staff type it into the system"; about
 * 15 minutes, R2-05). The patient fills the form on their own phone; it waits, encrypted, as a submission. Staff
 * see it on the Check-In page and in the queue as "Self-registered: verify ID", with every field filled. They check the
 * physical ID, correct anything (audited, field names only) and confirm: the submission becomes a patient record — or, when the
 * shared record already has this person from any branch (R2-08), staff choose "Use this record" (never merged automatically).
 * With "join today's queue" the confirmed patient is admitted as a walk-in through the existing Visit command.
 */
final class IntakeService
{
    public const CONSENT_VERSION = 'intake-2026-10';

    public const ID_TYPES = ['philid' => 'PhilID / ePhilID', 'drivers_license' => 'Driver’s license', 'umid' => 'UMID', 'passport' => 'Passport',
        'postal' => 'Postal ID', 'prc' => 'PRC ID', 'voters' => 'Voter’s ID', 'senior' => 'Senior citizen ID', 'pwd' => 'PWD ID', 'other' => 'Other valid ID'];

    public const PREFILLABLE = ['first_name', 'last_name', 'date_of_birth'];

    /** @param array $form validated by the controller */
    public function submit(Branch $branch, array $form, string $channel, ?string $deviceHash): IntakeSubmission
    {
        return IntakeSubmission::create([
            'reference' => $this->reference(), 'branch_id' => $branch->id, 'channel' => $channel,
            'data' => ['self' => $form['self'], 'dependents' => $form['dependents'] ?? []],
            'id_type' => $form['scan']['id_type'] ?? null,
            'scanned_fields' => array_values(array_intersect($form['scan']['fields'] ?? [], self::PREFILLABLE)),
            'join_queue' => (bool) ($form['join_queue'] ?? false), 'visit_for' => $form['visit_for'] ?? 'self',
            'status' => 'pending', 'consent_at' => now(), 'consent_version' => self::CONSENT_VERSION, 'device_hash' => $deviceHash,
        ]);
    }

    /** A signed-in patient (or their dependent) joins today's queue: no form, staff still check the ID. */
    public function submitForAccount(Branch $branch, Patient $patient, string $visitFor, ?string $deviceHash): IntakeSubmission
    {
        $open = IntakeSubmission::where('account_patient_id', $patient->id)->where('branch_id', $branch->id)->where('status', 'pending')
            ->where('visit_for', $visitFor)->where('created_at', '>=', ClinicClock::at(ClinicClock::today(), '00:00')->toIso8601String())->first();
        if ($open) return $open;

        return IntakeSubmission::create(['reference' => $this->reference(), 'branch_id' => $branch->id, 'channel' => 'account', 'account_patient_id' => $patient->id,
            'join_queue' => true, 'visit_for' => $visitFor, 'status' => 'pending', 'consent_at' => now(), 'consent_version' => self::CONSENT_VERSION, 'device_hash' => $deviceHash]);
    }

    /**
     * Possible existing patients in the SHARED record (every branch): the same name and birth date, plus the same phone or email.
     * Never merged automatically; staff decide.
     *
     * @return Collection<int, array{patient:Patient, found_from:?string, has_account:bool, guardians:array}>
     */
    public function duplicates(array $person): Collection
    {
        if (empty($person['first_name']) || empty($person['last_name']) || empty($person['date_of_birth'])) return collect();
        $rows = Person::query()
            ->whereRaw('lower(first_name) = ?', [Str::lower(trim($person['first_name']))])
            ->whereRaw('lower(last_name) = ?', [Str::lower(trim($person['last_name']))])
            ->where('date_of_birth', $person['date_of_birth'])
            ->where(fn ($q) => $q->when(! empty($person['phone']), fn ($w) => $w->orWhere('phone', $person['phone']))
                ->when(! empty($person['email']), fn ($w) => $w->orWhereRaw('lower(email) = ?', [Str::lower($person['email'])]))
                ->when(empty($person['phone']) && empty($person['email']), fn ($w) => $w->whereRaw('false')))
            ->with(['patient.preferredBranch', 'user'])->get();

        return $rows->filter(fn (Person $p) => $p->patient)->map(fn (Person $p) => [
            'patient' => $p->patient, 'found_from' => $this->foundFrom($p->patient), 'has_account' => $p->user !== null,
            'guardians' => $p->patient->guardianLinks()->with('guardian.person')->get()->map(fn ($l) => $l->guardian?->person?->fullName())->filter()->values()->all(),
        ])->values();
    }

    /** The branch the shared record was last seen at (its last visit or appointment, else the preferred branch). */
    public function foundFrom(Patient $patient): ?string
    {
        $visit = Visit::where('patient_id', $patient->id)->with('branch')->latest('arrived_at')->first();
        if ($visit) return $visit->branch?->name;
        $appointment = Appointment::where('patient_id', $patient->id)->with('branch')->latest('starts_at')->first();

        return $appointment?->branch?->name ?? $patient->preferredBranch?->name;
    }

    /**
     * Staff confirm a submission. $input: use_patient (public id of an existing record, or null for a new one), corrections
     * (field => value for the person), id_type + id_verified (the physical ID was checked), id_last4 (only if the Owner allows),
     * service_ref / dentist_ref for the walk-in admission. Returns [submission, patient admitted or null].
     */
    public function confirm(IntakeSubmission $submission, User $staff, array $input): array
    {
        return DB::transaction(function () use ($submission, $staff, $input) {
            $current = IntakeSubmission::whereKey($submission->id)->lockForUpdate()->firstOrFail();
            if ($current->status !== 'pending') throw ValidationException::withMessages(['submission' => ['This registration was already handled. Refresh the list.']]);
            DB::statement('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
            $corrected = [];
            if ($current->channel === 'account') {
                $holder = $current->accountPatient;
                $patient = $this->visitPatient($holder, $current->visit_for);
            } else {
                $data = $current->data;
                $self = $data['self'];
                foreach (($input['corrections'] ?? []) as $field => $value) {
                    if (in_array($field, ['first_name', 'last_name', 'date_of_birth', 'sex', 'phone', 'email', 'address', 'emergency_contact'], true) && ($self[$field] ?? null) !== $value) {
                        $self[$field] = $value; $corrected[] = $field;
                    }
                }
                if (! empty($input['use_patient'])) {
                    $holder = Patient::where('public_id', $input['use_patient'])->firstOrFail();
                    $matches = $this->duplicates($self)->pluck('patient.id');
                    if (! $matches->contains($holder->id)) throw ValidationException::withMessages(['use_patient' => ['Choose one of the possible existing records shown.']]);
                } else {
                    $holder = $this->createPatient($self, $staff);
                }
                $dependents = [];
                foreach ($data['dependents'] ?? [] as $i => $d) {
                    $dependents[$i] = Guardianship::addDependent($holder, $d, $staff, 'counter');
                }
                $patient = str_starts_with($current->visit_for, 'dependent:') ? ($dependents[(int) substr($current->visit_for, 10)] ?? $holder) : $holder;
            }
            if (! empty($input['id_verified'])) $this->recordIdCheck($holder, $staff, (string) ($input['id_type'] ?? $current->id_type ?? 'other'), $input['id_last4'] ?? null, $input['other_details'] ?? null);
            $current->update(['status' => 'confirmed', 'patient_id' => $holder->id, 'confirmed_by_user_id' => $staff->id, 'confirmed_at' => now(),
                // The form is no longer needed once it is the patient record: keep only what is required to show the history.
                'data' => $current->channel === 'account' ? null : ['confirmed' => true]]);
            app(AuditService::class)->recordAdministrative('intake.confirmed', $staff, $holder, ['submission' => $current->reference, 'channel' => $current->channel,
                'used_existing_record' => ! empty($input['use_patient']), 'corrected_fields' => $corrected, 'id_checked' => ! empty($input['id_verified'])]);
            $visitId = null;
            if ($current->join_queue) {
                $branch = $current->branch;
                // Booked for today at this branch: check in THAT appointment (its Dentist's queue; a late arrival still goes to the
                // end of the queue, R2-07). Otherwise a walk-in with the chosen service and Dentist, or "any available".
                $booked = Appointment::where('patient_id', $patient->id)->where('branch_id', $branch->id)->whereIn('status', ['Pending', 'Confirmed'])->whereDoesntHave('visit')
                    ->where('starts_at', '>=', ClinicClock::at(ClinicClock::today(), '00:00')->toIso8601String())->where('starts_at', '<', ClinicClock::at(ClinicClock::addDays(ClinicClock::today(), 1), '00:00')->toIso8601String())
                    ->orderBy('starts_at')->first();
                if ($booked) {
                    $response = app(VisitService::class)->checkInScheduled($staff, $booked, $booked->revision, 'intake-'.$current->public_id);
                } else {
                    $service = ! empty($input['service_ref']) ? Service::where('legacy_ref', $input['service_ref'])->first() : null;
                    $dentist = ! empty($input['dentist_ref']) ? DentistProfile::where('legacy_ref', $input['dentist_ref'])->first() : null;
                    if ($service && ! $dentist) $dentist = $this->shortestQueue($branch, $service);
                    $response = app(VisitService::class)->walkIn($staff, $patient, $branch, $service, $dentist, 'intake-'.$current->public_id);
                }
                $visitId = $response->getData(true)['data']['id'] ?? null;
                if ($visitId) $current->update(['visit_id' => Visit::where('public_id', $visitId)->value('id')]);
            }

            return [$current->fresh(), $patient, $visitId];
        });
    }

    /**
     * "Any available": the Dentist who can do the service at this branch, is working at this branch now (M3 schedule, not on leave) and has the fewest patients waiting in
     * today's queue (ties: lowest profile id). Null when nobody is eligible (the walk-in is then admitted without a queue).
     */
    public function shortestQueue(Branch $branch, Service $service): ?DentistProfile
    {
        $scheduling = app(\App\Services\Scheduling\SchedulingService::class);
        // Working now at this branch: M3 schedule and not on approved leave (M15).
        $eligible = $scheduling->eligibleDentists($branch, $service)->filter(fn (DentistProfile $d) => $scheduling->work()->workingNow($d, $branch));
        if ($eligible->isEmpty()) return null;
        $waiting = DB::table('queue_entries as q')->join('dentist_queues as dq', 'dq.id', '=', 'q.dentist_queue_id')
            ->where('dq.branch_id', $branch->id)->where('dq.clinic_date', ClinicClock::today())->whereIn('q.status', ['In Queue', 'Waiting', 'Called', 'Treatment Ready'])
            ->groupBy('dq.dentist_profile_id')->selectRaw('dq.dentist_profile_id, count(*) as n')->pluck('n', 'dentist_profile_id');

        return $eligible->sortBy(fn (DentistProfile $d) => [(int) ($waiting[$d->id] ?? 0), $d->id])->first();
    }

    public function cancel(IntakeSubmission $submission, User $staff): IntakeSubmission
    {
        if ($submission->status !== 'pending') throw ValidationException::withMessages(['submission' => ['This registration was already handled.']]);
        $submission->update(['status' => 'cancelled', 'data' => $submission->channel === 'account' ? null : ['cancelled' => true]]);
        app(AuditService::class)->recordAdministrative('intake.cancelled', $staff, null, ['submission' => $submission->reference]);

        return $submission;
    }

    /** One click at Check-In: the physical ID was checked. Only the type, who and when (and the last 4 if the Owner allows). */
    public function recordIdCheck(Patient $patient, User $staff, string $idType, ?string $last4 = null, ?string $otherDetails = null): Patient
    {
        if (! array_key_exists($idType, self::ID_TYPES)) throw ValidationException::withMessages(['id_type' => ['Choose the type of ID.']]);
        $otherDetails = $idType === 'other' ? trim((string) $otherDetails) : null;
        if ($idType === 'other' && ($otherDetails === null || $otherDetails === '')) {
            throw ValidationException::withMessages(['other_details' => ['Specify the ID type.']]);
        }
        $keepLast4 = (bool) (AutomationCatalog::setting('intake')?->settings['store_id_last4'] ?? false);
        $last4 = $keepLast4 && $last4 !== null ? strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $last4), -4)) : null;
        return DB::transaction(function () use ($patient, $staff, $idType, $last4, $otherDetails) {
            $locked = Patient::whereKey($patient->id)->lockForUpdate()->firstOrFail();
            // Existing intake/account-offer callers retain this model instance after the check.
            $patient->setRawAttributes($locked->getAttributes(), true);
            $dateFormat = $patient->getDateFormat();
            $patient->setDateFormat('Y-m-d H:i:sP');
            try {
                $patient->forceFill([
                    'id_type' => $idType,
                    'other_details' => $otherDetails ?: null,
                    'id_last4' => $last4 ?: null,
                    'id_verified_by_user_id' => $staff->id,
                    'id_verified_at' => ClinicClock::now(),
                ])->save();

                $auditPayload = ['id_type' => $idType, 'last4_kept' => $last4 !== null];
                if ($otherDetails !== null && $otherDetails !== '') {
                    $auditPayload['other_details'] = $otherDetails;
                }
                app(AuditService::class)->recordAdministrative('patient.id_verified_in_person', $staff, $patient, $auditPayload);

                return $patient;
            } finally {
                $patient->setDateFormat($dateFormat);
            }
        });
    }

    private function createPatient(array $self, User $staff): Patient
    {
        if (! empty($self['email']) && Person::whereRaw('lower(email) = ?', [Str::lower($self['email'])])->exists()) {
            throw ValidationException::withMessages(['email' => ['This email is already on another patient record. Use that record, or remove the email.']]);
        }
        $person = Person::create(['first_name' => trim($self['first_name']), 'last_name' => trim($self['last_name']), 'date_of_birth' => $self['date_of_birth'],
            'sex' => $self['sex'] ?? null, 'phone' => $self['phone'], 'email' => ! empty($self['email']) ? Str::lower($self['email']) : null, 'address' => $self['address'] ?? null]);
        $patient = Patient::create(['person_id' => $person->id, 'patient_code' => Patient::nextCode(), 'consent' => true,
            'emergency_contact' => trim(($self['emergency_contact']['name'] ?? '').' · '.($self['emergency_contact']['phone'] ?? ''), ' ·') ?: null]);
        $patient->forceFill(['registration_source' => 'counter'])->save();

        return $patient;
    }

    private function visitPatient(Patient $holder, string $visitFor): Patient
    {
        if ($visitFor === 'self') return $holder;
        $dependent = Patient::where('public_id', substr($visitFor, 10))->first();

        return $dependent && Guardianship::canActFor($holder->user, $dependent) ? $dependent : $holder;
    }

    private function reference(): string
    {
        do { $ref = 'IN-'.strtoupper(Str::random(6)); } while (IntakeSubmission::where('reference', $ref)->exists());

        return $ref;
    }
}
