<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\BranchService;
use App\Models\Service;
use App\Models\Visit;
use App\Support\DevelopmentClinicCatalog as Catalog;
use App\Support\SupabaseDevelopmentTarget;
use Illuminate\Console\Command;
use RuntimeException;
use Throwable;

final class InstallDevelopmentClinicCatalog extends Command
{
    private const PROJECT = 'awjbqjuewnbglwmusmsx';

    protected $signature = 'dentalops:development-clinic-catalog
        {mode=preflight : preflight or apply}
        {--project= : Dedicated Supabase project}
        {--confirm= : Repeat the project reference for apply}
        {--data-api-disabled : Operator confirms the Data API is disabled}';

    protected $description = 'Install the approved clinic identities and provisional development service catalog';

    public function handle(): int
    {
        $apply = $this->argument('mode') === 'apply';
        if (! in_array($this->argument('mode'), ['preflight', 'apply'], true)
            || $this->option('project') !== self::PROJECT
            || ($apply && ($this->option('confirm') !== self::PROJECT || ! $this->option('data-api-disabled')))) {
            $this->error('The dedicated project and explicit apply confirmations are required.');
            return self::FAILURE;
        }

        try {
            $db = SupabaseDevelopmentTarget::connection(self::PROJECT);
            [$paths, $held] = SupabaseDevelopmentTarget::inventory();
            $approved = array_map(fn (string $path) => pathinfo($path, PATHINFO_FILENAME), $paths);
            $db->transaction(function () use ($db, $apply, $approved, $held) {
                if (! $apply) $db->statement('SET TRANSACTION READ ONLY');
                $db->statement("SET LOCAL lock_timeout = '5s'");
                $db->statement('SET LOCAL row_security = off');
                $identity = $db->selectOne("SELECT current_database() = 'postgres' AND current_schema() = 'public' AND current_user = session_user AND current_user = ? AS verified",
                    [strstr($db->getConfig('username'), '.', true)]);
                if (! $identity->verified) throw new RuntimeException('Unexpected connected database identity.');
                if ($apply) {
                    $db->statement('LOCK TABLE public.appointments, public.visits, public.branches, public.services, public.branch_services IN SHARE ROW EXCLUSIVE MODE');
                }
                $ledger = $db->table('migrations')->pluck('migration')->all();
                sort($ledger);
                sort($approved);
                if ($ledger !== $approved || array_intersect($ledger, $held)) throw new RuntimeException('Unexpected migration ledger.');

                $demoBranches = Branch::whereIn('legacy_ref', ['demo-a', 'demo-b'])->pluck('id');
                $demoServices = Service::whereIn('legacy_ref', ['demo-consult', 'demo-follow-up'])->pluck('id');
                $appointments = Appointment::where(fn ($q) => $q->whereIn('branch_id', $demoBranches)->orWhereIn('service_id', $demoServices));
                $visits = Visit::whereIn('branch_id', $demoBranches);
                $this->line('Demo references: '.$appointments->count().' appointments, '.$visits->count().' visits.');
                if ((clone $appointments)->whereIn('status', Appointment::ACTIVE_STATUSES)->exists()
                    || (clone $visits)->whereNull('closed_at')->exists()) {
                    throw new RuntimeException('An active demo booking or visit must be resolved before retiring its catalog.');
                }
                if (! $apply) return;

                $branches = [];
                foreach (Catalog::BRANCHES as $ref => [$name, $address, $phone, $city, $latitude, $longitude]) {
                    $branch = Branch::firstOrNew(['legacy_ref' => $ref], [
                        'branch_code' => 'BRC-'.strtoupper($ref),
                        'open_time' => '00:00:00', 'close_time' => '00:00:00',
                        'weekly_hours' => array_fill(1, 7, null), 'status' => 'Open',
                    ]);
                    $branch->fill(compact('name', 'address', 'phone', 'city', 'latitude', 'longitude'))->save();
                    $branches[] = $branch;
                }

                $definitions = Catalog::SERVICES + [Catalog::INTERNAL_CONSULTATION =>
                    ['Prosthodontic Consultation', 'Prosthodontics', 50000, null, null, 'Assess denture needs and discuss treatment options.']];
                $services = [];
                $new = [];
                foreach ($definitions as $ref => [$name, $category, $amount, $unit, $consult, $description]) {
                    $service = Service::firstOrCreate(['legacy_ref' => $ref], [
                        'code' => strtoupper($ref), 'name' => $name, 'category' => $category,
                        'reference_fee_php' => sprintf('%d.%02d', intdiv($amount, 100), $amount % 100),
                        'description' => $description, 'duration_minutes' => 30, 'status' => 'Active',
                    ]);
                    $services[$ref] = $service;
                    $new[$ref] = $service->wasRecentlyCreated;
                }
                foreach ($definitions as $ref => $definition) {
                    $service = $services[$ref];
                    if (! $new[$ref]) continue;
                    if ($consult = $definition[4]) {
                        $service->forceFill(['online_booking' => 'consultation_first', 'consultation_service_id' => $services[$consult]->id])->save();
                    }
                    foreach ($branches as $branch) {
                        BranchService::firstOrCreate(['branch_id' => $branch->id, 'service_id' => $service->id], ['active' => true]);
                    }
                }

                Branch::whereIn('id', $demoBranches)->where('status', '<>', 'Closed')->update(['status' => 'Closed']);
                Service::whereIn('id', $demoServices)->where('online_booking', '<>', 'hidden')->update(['online_booking' => 'hidden']);
                $this->line('Clinic records: '.count($branches).'; public development services: '.count(Catalog::SERVICES).'; internal consultation: 1.');
            });
            $this->info($apply ? 'Catalog changes committed.' : 'Read-only preflight passed.');
            return self::SUCCESS;
        } catch (RuntimeException $e) {
            $messages = ['Unexpected connected database identity.', 'Unexpected migration ledger.', 'An active demo booking or visit must be resolved before retiring its catalog.'];
            $this->error(in_array($e->getMessage(), $messages, true) ? $e->getMessage() : 'Catalog operation rolled back ('.class_basename($e).').');
        } catch (Throwable $e) {
            $this->error('Catalog operation stopped ('.class_basename($e).').');
        }
        return self::FAILURE;
    }
}
