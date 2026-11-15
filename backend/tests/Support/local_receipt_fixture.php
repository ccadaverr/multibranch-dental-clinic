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

// Synthetic prerequisites only. Browser acceptance explicitly performs new care/billing commands; existing care is untouched.
$path = getenv('DENTALOPS_LOCAL_TARGET');
if (getenv('DENTALOPS_LOCAL_RECEIPT_FIXTURE') !== '1' || ! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
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
    $b=Branch::where('legacy_ref','sprint02')->firstOrFail();$base=User::where('email','sprint02.dentist@example.test')->firstOrFail();
    $u=User::where('email','sprint05.dentist@example.test')->first();
    if(!$u){$p=Person::create(['first_name'=>'Receipt','last_name'=>'Synthetic Acceptance','email'=>'sprint05.dentist@example.test','phone'=>'09171234599']);$u=User::create(['person_id'=>$p->id,'email'=>$p->email,'role'=>'dentist','account_status'=>'Active','password'=>$base->getRawOriginal('password')]);$u->email_verified_at=now();$u->save();}
    $d=DentistProfile::firstOrCreate(['person_id'=>$u->person_id],['legacy_ref'=>'sprint05-receipt-dentist','legacy_user_ref'=>$u->public_id,'shift_start'=>'00:00','shift_end'=>'23:59','available'=>true]);
    $d->branches()->syncWithoutDetaching([$b->id]);$svc=Service::where('legacy_ref','svc2')->firstOrFail();$d->services()->syncWithoutDetaching([$svc->id=>['is_authorized'=>true]]);
    foreach(range(1,7)as$day)DentistSchedule::firstOrCreate(['dentist_profile_id'=>$d->id,'branch_id'=>$b->id,'weekday'=>$day],['start_time'=>'00:00','end_time'=>'23:59','demo'=>true]);
    \App\Models\ServicePrice::firstOrCreate(['service_id'=>$svc->id,'branch_id'=>$b->id,'effective_from'=>'2026-11-15'],['kind'=>'priced','amount'=>'125.50','source'=>'owner_confirmed','created_by_user_id'=>User::where('role','owner')->firstOrFail()->id,'created_at'=>now()]);
    return ['dentist'=>$d->legacy_ref,'service'=>$svc->legacy_ref,'branch'=>$b->legacy_ref,'amount'=>'125.50','synthetic'=>true];
});
echo json_encode($result);
