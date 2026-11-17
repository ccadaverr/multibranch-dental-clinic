<?php

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use App\Models\Branch;
use App\Models\BranchService;
use App\Models\DentistProfile;
use App\Models\DentistSchedule;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Service;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

// Only the verified local runner may create these synthetic prerequisites. No lifecycle results are seeded.
$path = getenv('DENTALOPS_LOCAL_TARGET');
if (getenv('DENTALOPS_LOCAL_VISIT_FIXTURE') !== '1' || ! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
    throw new RuntimeException('Private verified local fixture runner required.');
}
$target = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
if (! app()->environment('local') || realpath($target['root'] ?? '') !== realpath(base_path('..')) || ($target['host'] ?? '') !== '127.0.0.1' || config('database.connections.pgsql.database') !== 'dental_clinic_demo' || config('database.connections.pgsql.host') !== $target['host'] || (int) config('database.connections.pgsql.port') !== $target['port']) {
    throw new RuntimeException('Refusing non-isolated fixture');
}
$identity = DB::selectOne('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT cluster_id FROM local_development.identity) AS marker');
if ($identity->db !== 'dental_clinic_demo' || $identity->host !== $target['host'] || (int) $identity->port !== $target['port'] || $identity->marker !== $target['cluster_id']) {
    throw new RuntimeException('Actual local cluster identity mismatch.');
}
$contactsOnly = in_array('--contacts-only', $argv ?? [], true);
if ($contactsOnly && (is_link($target['runtime'].'/synthetic-runtime')
    || ! is_file($target['runtime'].'/synthetic-runtime')
    || trim(file_get_contents($target['runtime'].'/synthetic-runtime')) !== $target['cluster_id'])) {
    throw new RuntimeException('The contact update requires the owned synthetic rehearsal marker.');
}

$result = DB::transaction(function () use ($contactsOnly) {
    $name = 'Synthetic Sprint 02 — not clinic hours';
    $query = Branch::where('legacy_ref', 'sprint02')->lockForUpdate();
    $b = $contactsOnly ? $query->firstOrFail() : $query->firstOrCreate(
        ['legacy_ref' => 'sprint02'],
        ['branch_code' => 'BRC-SP02', 'name' => $name, 'city' => 'Synthetic', 'address' => 'Synthetic local acceptance only', 'open_time' => '00:00', 'close_time' => '23:59', 'status' => 'Open', 'capacity_threshold' => 80],
    );
    if ($b->branch_code !== 'BRC-SP02' || $b->name !== $name || $b->address !== 'Synthetic local acceptance only') {
        throw new RuntimeException('Refusing to change a branch outside the rehearsal fixture.');
    }

    $b->phone ??= '+1 202 555 0142'; // Reserved fictional number. This fixture cannot send messages.
    if ($b->weekly_hours === null || $b->weekly_hours === []) {
        $b->weekly_hours = collect(range(1, 7))->mapWithKeys(fn ($day) => [$day => $b->hoursOnDay($day)])->all();
    }
    if ($b->isDirty()) {
        $b->save();
    }
    if ($contactsOnly) {
        return ['branch' => $b->legacy_ref, 'syntheticContactsConfigured' => true];
    }
    // Reopen only this named synthetic fixture when explicitly preparing another local journey.
    $b->update(['status' => 'Open']);
    $base = User::where('email', 'staff.reception@example.test')->firstOrFail();
    $make = function ($role, $email, $first) use ($base) {
        $u = User::where('email', $email)->first();
        if ($u) {
            return $u;
        }
        $p = Person::create(['first_name' => $first, 'last_name' => 'Synthetic Sprint', 'email' => $email, 'phone' => '09171234599', 'date_of_birth' => '1990-01-01']);
        $u = User::create(['person_id' => $p->id, 'email' => $email, 'role' => $role, 'account_status' => 'Active', 'password' => $base->getRawOriginal('password')]);
        $u->email_verified_at = now();
        $u->save();

        return $u;
    };
    $s = $make('staff', 'sprint02.staff@example.test', 'Reception');
    $d = $make('dentist', 'sprint02.dentist@example.test', 'Dentist');
    $p = $make('patient', 'sprint02.patient@example.test', 'Patient');
    UserBranchScope::firstOrCreate(['user_id' => $s->id, 'branch_id' => $b->id]);
    StaffProfile::firstOrCreate(['person_id' => $s->person_id], ['legacy_ref' => 'sprint02-staff', 'title' => 'Receptionist', 'branch_id' => $b->id, 'shift_start' => '00:00', 'shift_end' => '23:59', 'available' => true]);
    $dentist = DentistProfile::firstOrCreate(['person_id' => $d->person_id], ['legacy_ref' => 'sprint02-dentist', 'shift_start' => '00:00', 'shift_end' => '23:59', 'available' => true]);
    if (! $dentist->branches()->where('branches.id', $b->id)->exists()) {
        $dentist->branches()->attach($b->id);
    }
    StaffProfile::where('person_id', $s->person_id)->update(['legacy_user_ref' => $s->public_id]);
    $dentist->update(['legacy_user_ref' => $d->public_id]);
    $service = Service::where('legacy_ref', 'svc2')->firstOrFail();
    BranchService::firstOrCreate(['branch_id' => $b->id, 'service_id' => $service->id], ['active' => true]);
    if (! $dentist->services()->where('services.id', $service->id)->exists()) {
        $dentist->services()->attach($service->id, ['is_authorized' => true]);
    }
    foreach (range(1, 7) as $day) {
        DentistSchedule::firstOrCreate(['dentist_profile_id' => $dentist->id, 'branch_id' => $b->id, 'weekday' => $day], ['start_time' => '00:00', 'end_time' => '23:59', 'demo' => true]);
    }
    $patient = Patient::firstOrCreate(['person_id' => $p->person_id], ['patient_code' => Patient::nextCode(), 'consent' => true]);

    return ['branch' => $b->legacy_ref, 'dentist' => $dentist->legacy_ref, 'service' => $service->legacy_ref, 'serviceName' => $service->name, 'patientId' => $patient->public_id, 'patientCode' => $patient->patient_code, 'patientName' => $p->person->fullName()];
});
echo json_encode($result);
