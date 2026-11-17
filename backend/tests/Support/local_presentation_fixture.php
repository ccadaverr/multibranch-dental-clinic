<?php

use App\Models\Invoice;
use App\Models\User;
use App\Services\Billing\BillingService;
use App\Support\ClinicClock;
use Database\Seeders\DemoUnpaidInvoiceSeeder;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$path = getenv('DENTALOPS_LOCAL_TARGET');
if (! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
    throw new RuntimeException('An owned private presentation target is required.');
}
$target = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
$config = config('database.connections.pgsql');
if (! app()->isLocal() || $target['demo_database'] !== 'dental_clinic_demo' || $config['database'] !== 'dental_clinic_demo'
    || $target['host'] !== '127.0.0.1' || $config['host'] !== '127.0.0.1' || (int) $config['port'] !== $target['port']
    || realpath($target['root']) !== realpath(base_path('..')) || getenv('DENTALOPS_PRESENTATION_FIXTURE') !== '1') {
    throw new RuntimeException('Refusing a non-isolated presentation fixture.');
}
$identity = DB::selectOne("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port,
    (SELECT cluster_id FROM local_development.identity) AS marker");
if ($identity->db !== 'dental_clinic_demo' || $identity->host !== $target['host'] || (int) $identity->port !== $target['port']
    || $identity->marker !== $target['cluster_id']) {
    throw new RuntimeException('The connected database identity differs from the private target.');
}

$out = $target['runtime'].'/presentation-finance.json';
if (file_exists($out)) {
    throw new RuntimeException('Prepare presentation finance once on a fresh synthetic database.');
}

$actor = User::where('email', 'staff.reception@example.test')->firstOrFail();
$patient = User::where('email', 'patient@example.test')->where('role', 'patient')->firstOrFail()->patient;
if (! Invoice::exists()) {
    app(DemoUnpaidInvoiceSeeder::class)->run();
}
$invoice = Invoice::where('patient_id', $patient->id)
    ->whereHas('branch', fn ($branch) => $branch->where('legacy_ref', 'b1'))
    ->where('status', 'Issued')
    ->where('paid_amount', 0)
    ->whereDoesntHave('payment')
    ->whereDoesntHave('receipt')
    ->sole();
$invoice = app(BillingService::class)->pay($actor, $invoice, $invoice->revision, 'Cash', null);
$invoice->loadMissing(['branch', 'payment', 'receipt']);
if ($invoice->status !== 'Paid' || ! $invoice->payment || ! $invoice->receipt) {
    throw new RuntimeException('The synthetic cash payment did not produce its exact receipt.');
}
$data = [
    'date' => ClinicClock::local($invoice->payment->recorded_at)->toDateString(),
    'amount' => (string) $invoice->payment->amount,
    'branch' => ['id' => $invoice->branch->legacy_ref, 'publicId' => $invoice->branch->public_id, 'name' => $invoice->branch->name],
    'invoiceNumber' => $invoice->invoice_number,
    'receiptNumber' => $invoice->receipt->receipt_number,
];
file_put_contents($out, json_encode($data, JSON_THROW_ON_ERROR), LOCK_EX);
chmod($out, 0600);
