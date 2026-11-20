<?php

namespace App\Console\Commands;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Service;
use App\Models\User;
use App\Services\Appointments\AppointmentService;
use App\Services\Audit\AuditService;
use App\Services\Scheduling\SchedulingService;
use App\Services\Scheduling\SlotRequest;
use App\Support\ClinicClock;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use InvalidArgumentException;
use Throwable;

/**
 * Narrow, additive, idempotent Staff demonstration fixture for an already-initialized development database.
 * 20 synthetic patient identities, 10 valid future Staff bookings, 10 Staff follow-up tasks (some overdue).
 * NEVER fabricates past appointments, completed treatments, prescriptions or payments.
 * Uses the existing AppointmentService for scheduled bookings, including conflict/dentist validation.
 */
final class InstallStaffScenarios extends Command
{
    protected $signature = 'dentalops:staff-scenarios
        {mode=dry-run : dry-run or apply}
        {--project= : Exact development Supabase project reference}
        {--confirm= : Repeat the target project reference to authorize apply}
        {--accept-synthetic : Explicitly acknowledge these are hypothetical demo-only patients}';

    protected $description = 'Add only the authorized, repeatable R08 synthetic Staff scenarios to the existing development project';

    private const PROJECT = 'awjbqjuewnbglwmusmsx';
    private const PREFIX = 'r08-staff-scenario-';

    public function handle(SchedulingService $schedule, AppointmentService $appointments, AuditService $audit): int
    {
        try {
            $mode = (string) $this->argument('mode');
            $this->require(in_array($mode, ['dry-run', 'apply'], true), 'Use dry-run or apply.');
            $apply = $mode === 'apply';
            $project = (string) $this->option('project');
            $this->require($project === self::PROJECT, 'This fixture is restricted to the approved Supabase development project.');
            $this->require(app()->environment('local'), 'This command is development-only.');
            $this->require(config('database.default') === 'pgsql', 'The default database must be PostgreSQL.');
            $username = (string) config('database.connections.pgsql.username');
            $this->require(str_contains($username, self::PROJECT), 'Database username does not identify the approved Supabase project.');
            $db = DB::selectOne('select current_database() as database, current_schema() as schema');
            $this->require($db && $db->database === 'postgres' && $db->schema === 'public', 'Wrong PostgreSQL database or schema.');
            $this->require(DB::table('migrations')->count() >= 87, 'The approved development schema is not initialized.');
            foreach (['2026_11_10_000100_remove_patient_feedback_table', '2026_11_15_000400_backfill_tooth_chart_branch',
                '2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes', '2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority'] as $held) {
                $this->require(! DB::table('migrations')->where('migration', $held)->exists(), 'Previously held migrations must stay excluded.');
            }
            if ($apply) $this->require($this->option('confirm') === $project && (bool) $this->option('accept-synthetic'),
                'Apply requires --confirm=<project> and --accept-synthetic.');

            $staff = User::where('email', 'staff.reception@example.test')->with('person')->first();
            $this->require($staff && $staff->role === Role::Staff && $staff->account_status === 'Active', 'Synthetic Staff account unavailable.');
            $branchIds = $staff->branchScopes()->pluck('branch_id')->all();
            $branch = Branch::whereIn('id', $branchIds)->where('status', 'Open')
                ->where('name', 'Dr. Dana Roxas Dental Clinic')->first();
            $this->require($branch !== null, 'Primary synthetic Staff account cannot work the expected active branch.');
            Gate::forUser($staff)->authorize('book', [Appointment::class, $branch]);
            $service = Service::where('name', 'Dental Consultation')->where('status', 'Active')->first();
            $this->require($service && $schedule->branchService($branch, $service), 'Dental Consultation is not bookable at the Staff branch.');

            $this->line('Project: '.self::PROJECT.' | branch: '.$branch->name);
            $this->line('Scenario plan: 20 synthetic Patient records; 10 scheduled future consultations; 10 manually recorded follow-up tasks.');
            $this->line('No past visits, treatment completions, invoices, prescriptions, or payment success will be fabricated.');
            // Precheck all identities before any writes. Never claim or repurpose an unrelated record.
            $patients = [];
            for ($i = 1; $i <= 20; $i++) {
                $email = $this->email($i);
                $person = Person::where('email', $email)->first();
                if ($person) {
                    $this->require($person->first_name === 'Scenario' && $person->last_name === sprintf('Patient %02d', $i)
                        && Patient::where('person_id', $person->id)->exists() && ! User::where('person_id', $person->id)->exists(),
                        "A non-synthetic identity already uses fixture address $email.");
                    $patients[$i] = Patient::where('person_id', $person->id)->firstOrFail();
                }
            }
            $this->line(count($patients).' existing scenario Patients are already present.');
            // Preflight scheduling without creating patients or reservations. Actual writes revalidate
            // every slot through the authoritative AppointmentService and database constraints.
            $available = 0;
            for ($offset = 1; $offset <= 30 && $available < 10; $offset++) {
                $date = ClinicClock::addDays(ClinicClock::today(), $offset);
                $probe = new SlotRequest(null, $branch, $service, null, $date, '08:00', false, null, false);
                $available += count($schedule->slotsOn($probe, $date, limit: 10));
            }
            $this->require($available >= 10 || Appointment::where('notes', 'like', self::PREFIX.'%')->count() >= 10,
                'Fewer than ten suitable future appointment slots are available. Publish a valid Dentist roster before applying.');
            $this->line('Availability preflight: at least ten future consultation slots, subject to revalidation on write.');
            if (! $apply) {
                $this->info('Read-only preflight passed. Apply only with both explicit confirmation flags.');
                return self::SUCCESS;
            }

            DB::transaction(function () use ($staff, $branch, $service, $schedule, $appointments, $audit, &$patients) {
                DB::statement("SET LOCAL lock_timeout = '5s'");
                DB::statement("SET LOCAL statement_timeout = '90s'");
                $locked = DB::selectOne("select pg_try_advisory_xact_lock(hashtext('dentalops:r08-staff-scenarios')) as acquired");
                $this->require((bool) $locked->acquired, 'A scenario installation is already running.');
                DB::statement('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
                for ($i = 1; $i <= 20; $i++) {
                    if (isset($patients[$i])) continue;
                    $person = Person::create(['first_name' => 'Scenario', 'last_name' => sprintf('Patient %02d', $i),
                        'email' => $this->email($i)]);
                    $patient = Patient::create(['person_id' => $person->id, 'patient_code' => Patient::nextCode(), 'consent' => false]);
                    $audit->recordClinical('patient.registered', $staff, $patient, ['source' => 'r08_synthetic_front_desk']);
                    $patients[$i] = $patient;
                }
                for ($i = 1; $i <= 10; $i++) {
                    $patient = $patients[$i];
                    $note = self::PREFIX.sprintf('%02d', $i).' — synthetic demo booking';
                    $existing = Appointment::where('patient_id', $patient->id)->where('notes', $note)->first();
                    if ($existing) continue;
                    $this->require(! Appointment::where('patient_id', $patient->id)->exists(), 'Fixture patient has an unrelated appointment.');
                    $chosen = null;
                    for ($offset = 1; $offset <= 30; $offset++) {
                        $date = ClinicClock::addDays(ClinicClock::today(), $offset);
                        $base = new SlotRequest($patient, $branch, $service, null, $date, '08:00', false);
                        $slots = $schedule->slotsOn($base, $date, limit: 3);
                        if ($slots) { $chosen = $slots[0]; break; }
                    }
                    $this->require($chosen !== null, 'No valid Dentist slot is available; no partial fixture will be committed.');
                    $response = $appointments->create($staff, $patient, $branch, $service, null,
                        ['date' => $chosen['date'], 'start_time' => $chosen['start_time'], 'pay_at_clinic' => true, 'notes' => $note],
                        self::PREFIX.sprintf('%02d', $i));
                    $body = $response->getData(true);
                    $this->require(! empty($body['data']['id']), 'Booking response was not confirmed; rolling back fixture.');
                }
                for ($i = 11; $i <= 20; $i++) {
                    $patient = $patients[$i];
                    if (FollowupTask::where('patient_id', $patient->id)->where('source', 'front_desk')->exists()) continue;
                    // These are manually initiated synthetic recall tasks, not claims of clinical treatment.
                    $task = FollowupTask::create([
                        'patient_id' => $patient->id, 'branch_id' => $branch->id,
                        'reason' => 'Synthetic demonstration reminder; no clinical assessment has occurred.',
                        'due_on' => ClinicClock::addDays(ClinicClock::today(), $i <= 15 ? -($i - 9) : ($i - 14)),
                        'service_id' => $service->id, 'dentist_profile_id' => null,
                        'assignee_user_id' => $staff->id, 'source' => 'front_desk',
                        'status' => 'Open', 'created_by_user_id' => $staff->id, 'updated_by_user_id' => $staff->id,
                    ]);
                    $audit->recordAdministrative('followup.created', $staff, $patient, [
                        'task' => $task->public_id, 'source' => 'r08_synthetic_front_desk', 'due_on' => $task->dueOn(), 'branch' => $branch->legacy_ref,
                    ]);
                }
            }, 1);
            $this->info('Committed 20 synthetic Patient scenarios through guarded, repeatable development workflows.');
            return self::SUCCESS;
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
        } catch (Throwable $e) {
            // Do not echo raw database/provider exception messages (may contain connection credentials or patient data).
            $this->error('Installation refused or rolled back: '.class_basename($e).' ('.basename($e->getFile()).':'.$e->getLine().').');
        }
        return self::FAILURE;
    }

    private function email(int $i): string
    {
        return self::PREFIX.sprintf('%02d', $i).'@example.test';
    }

    private function require(bool $condition, string $reason): void
    {
        if (! $condition) throw new InvalidArgumentException($reason);
    }
}
