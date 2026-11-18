<?php

// Deliberate synthetic historical read data, not proof of clinical lifecycle commands.

use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Person;
use App\Models\ToothChartEntry;
use App\Models\Treatment;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$path = getenv('DENTALOPS_LOCAL_TARGET');
if (getenv('DENTALOPS_J05_HISTORY_FIXTURE') !== '1' || ! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
    throw new RuntimeException('Owned private synthetic J05 target required.');
}
$target = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
if (! app()->environment('local') || realpath($target['root'] ?? '') !== realpath(base_path('..')) || ! str_starts_with(basename($target['runtime'] ?? ''), 'jaztin-j05-') || ($target['host'] ?? '') !== '127.0.0.1' || config('database.connections.pgsql.database') !== 'dental_clinic_demo' || config('database.connections.pgsql.host') !== $target['host'] || (int) config('database.connections.pgsql.port') !== $target['port']) {
    throw new RuntimeException('Refusing existing/shared/non-demo target.');
}
$identity = DB::selectOne('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT cluster_id FROM local_development.identity) AS marker');
if ($identity->db !== 'dental_clinic_demo' || $identity->host !== $target['host'] || (int) $identity->port !== $target['port'] || $identity->marker !== $target['cluster_id'] || Patient::where('patient_code', 'SYN-J05-OLD')->exists()) {
    throw new RuntimeException('Wrong target or historical fixture already committed. Use a new target.');
}
$applied = DB::table('migrations')->orderBy('migration')->pluck('migration')->all();
$expected = $target['selected_migrations'];
sort($expected);
if ($applied !== $expected) {
    throw new RuntimeException('Exact reviewed schema prerequisite missing.');
}
$result = DB::transaction(function () {
    $fixture = json_decode(file_get_contents(getenv('DENTALOPS_LOCAL_TARGET') ? dirname(getenv('DENTALOPS_LOCAL_TARGET')).'/visit-fixture.json' : ''), true, flags: JSON_THROW_ON_ERROR);
    $patient = Patient::where('public_id', $fixture['patientId'])->firstOrFail();
    $branch = Branch::where('legacy_ref', $fixture['branch'])->firstOrFail();
    $dentist = DentistProfile::where('legacy_ref', $fixture['dentist'])->firstOrFail();
    $actor = User::where('person_id', $dentist->person_id)->firstOrFail();
    $person = Person::create(['first_name' => 'Historical', 'last_name' => 'Synthetic J05', 'date_of_birth' => '1990-01-01']);
    $oldPatient = Patient::create(['person_id' => $person->id, 'patient_code' => 'SYN-J05-OLD', 'consent' => true]);
    $ids = [];
    for ($i = 0; $i < 206; $i++) {
        $owner = $i === 205 ? $oldPatient : $patient;
        $visit = Visit::create(['patient_id' => $owner->id, 'branch_id' => $branch->id, 'responsible_dentist_profile_id' => $dentist->id,
            'source' => 'walk_in', 'status' => 'Completed', 'arrived_at' => '2025-01-01 09:00:00+08:00', 'closed_at' => '2025-01-01 10:00:00+08:00', 'clinic_date' => '2025-01-01', 'revision' => 3]);
        $treatment = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $dentist->id, 'status' => 'Completed',
            'started_at' => '2025-01-01 09:10:00+08:00', 'completed_at' => '2025-01-01 10:00:00+08:00', 'revision' => 3,
            'procedure_summary' => 'Synthetic J05 historical care '.($i + 1), 'clinical_notes' => 'Synthetic J05 historical documentation '.($i + 1)]);
        if ($i < 25) {
            ToothChartEntry::create(['patient_id' => $owner->id, 'dentist_profile_id' => $dentist->id, 'created_by_user_id' => $actor->id,
                'branch_id' => $branch->id, 'treatment_id' => $treatment->id, 'tooth' => '16', 'status' => $i % 2 ? 'Caries' : 'Filled',
                'surfaces' => ['O'], 'recorded_on' => '2025-01-01', 'note' => 'Synthetic J05 historical tooth finding '.($i + 1)]);
        }
        $ids[] = ['id' => $treatment->public_id, 'visitId' => $visit->public_id, 'patientId' => $owner->public_id];
    }

    return ['records' => $ids, 'olderOnlyPatient' => ['id' => $oldPatient->public_id, 'code' => $oldPatient->patient_code], 'syntheticReadFixture' => true];
});
echo json_encode($result, JSON_THROW_ON_ERROR);
