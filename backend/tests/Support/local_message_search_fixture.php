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
if (getenv('DENTALOPS_LOCAL_MESSAGE_FIXTURE') !== '1' || ! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
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
$result = DB::transaction(function () {
    $branch = Branch::where('legacy_ref', 'sprint02')->sole();
    $dentist = User::where('email', 'sprint02.dentist@example.test')->sole();
    $rows = [];
    foreach (['sprint02.patient@example.test', 'patient@example.test'] as $index => $email) {
        $user = User::where('email', $email)->sole();
        $patient = $user->patient;
        $context = 'Synthetic Batch07 search history '.$index;
        $conversation = App\Models\Conversation::firstOrCreate(['patient_id' => $patient->id, 'branch_id' => $branch->id, 'context' => $context], ['status' => 'Open', 'revision' => 1]);
        foreach ([$user, $dentist] as $actor) App\Models\ConversationParticipant::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $actor->id], ['created_at' => now()]);
        if (!$conversation->messages()->exists()) {
            for ($i=0; $i<65; $i++) App\Models\ConversationMessage::create(['conversation_id' => $conversation->id, 'sender_user_id' => $user->id, 'body' => ($index===0 ? 'Needle%_ <img src=x onerror=alert(1)> ' : 'Foreign separate history ').$i, 'created_at' => now()->subMinutes(65-$i)]);
            $conversation->update(['last_message_at' => now()]);
        }
        $rows[] = ['id' => $conversation->public_id, 'patientId' => $patient->public_id, 'code' => $patient->patient_code, 'name' => $patient->person->fullName(), 'branchId' => $branch->legacy_ref];
    }
    return $rows;
});
echo json_encode($result, JSON_THROW_ON_ERROR);
