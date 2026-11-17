<?php

namespace Tests\Feature\Runtime;

use App\Support\SyntheticRuntime;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SyntheticRuntimeBoundaryTest extends TestCase
{
    public function test_normal_schedule_does_not_require_or_claim_a_synthetic_runtime(): void
    {
        $old = getenv('DENTALOPS_SYNTHETIC_RUNTIME');
        try {
            putenv('DENTALOPS_SYNTHETIC_RUNTIME');
            DB::shouldReceive('selectOne')->never();
            $this->assertFalse(SyntheticRuntime::active());
            $kernel = $this->app->make(\Illuminate\Contracts\Console\Kernel::class);
            $kernel->all();
            $events = $this->app->make(\Illuminate\Console\Scheduling\Schedule::class)->events();
            foreach (['mail:process-due', 'automations:run', 'intake:expire', 'appointments:release-expired-holds'] as $command) {
                $this->assertCount(1, array_filter($events, fn ($event) => str_contains($event->command ?? '', $command)));
            }
        } finally {
            $old === false ? putenv('DENTALOPS_SYNTHETIC_RUNTIME') : putenv('DENTALOPS_SYNTHETIC_RUNTIME='.$old);
        }
    }

    public function test_opt_in_without_private_manifest_fails_before_database_or_work(): void
    {
        $old = getenv('DENTALOPS_SYNTHETIC_RUNTIME');
        $target = getenv('DENTALOPS_LOCAL_TARGET');
        try {
            putenv('DENTALOPS_SYNTHETIC_RUNTIME=1');
            putenv('DENTALOPS_LOCAL_TARGET=/nonexistent/runtime/target.json');
            DB::shouldReceive('selectOne')->never();
            $this->expectException(\RuntimeException::class);
            SyntheticRuntime::active();
        } finally {
            $old === false ? putenv('DENTALOPS_SYNTHETIC_RUNTIME') : putenv('DENTALOPS_SYNTHETIC_RUNTIME='.$old);
            $target === false ? putenv('DENTALOPS_LOCAL_TARGET') : putenv('DENTALOPS_LOCAL_TARGET='.$target);
        }
    }

    public function test_old_integration_target_cannot_opt_into_background_runtime(): void
    {
        $old = getenv('DENTALOPS_SYNTHETIC_RUNTIME');
        try {
            putenv('DENTALOPS_SYNTHETIC_RUNTIME=1');
            DB::shouldReceive('selectOne')->never();
            $this->expectException(\RuntimeException::class);
            SyntheticRuntime::active();
        } finally {
            $old === false ? putenv('DENTALOPS_SYNTHETIC_RUNTIME') : putenv('DENTALOPS_SYNTHETIC_RUNTIME='.$old);
        }
    }
}
