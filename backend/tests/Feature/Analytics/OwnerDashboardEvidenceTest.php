<?php
namespace Tests\Feature\Analytics;

use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Reuse the established synthetic billing fixture. Export aggregate-only read responses, never Patient/credential data. */
class OwnerDashboardEvidenceTest extends AnalyticsTest
{
    public function test_owner_dashboard_evidence_matches_postgres_and_saturday_generation(): void
    {
        parent::test_daily_revenue_and_weekly_histogram_handle_refunds_on_different_days_and_multiple_partial_refunds_without_double_counting();
        $this->travelTo(CarbonImmutable::parse('2026-10-03 12:00:00',ClinicClock::TIMEZONE));
        $evidence=['date'=>'2026-10-03','branches'=>[],'reports'=>[]];
        foreach(['all','b1','b2'] as $key){
            $branch=$key==='all'?null:$this->b[$key];$query=$branch?'&branch_id='.$branch->public_id:'';
            $daily=[];
            foreach(['week','month','year'] as $period)$daily[$period]=$this->getJson('/api/analytics/daily-revenue?period='.$period.$query)->assertOk()->json('data');
            $weekly=$this->getJson('/api/analytics/weekly-histogram?date=2026-10-03'.$query)->assertOk()->json('data');
            $sum=DB::table('payments')->join('invoices','invoices.id','=','payments.invoice_id')->when($branch,fn($q)=>$q->where('invoices.branch_id',$branch->id))->sum('payments.amount');
            $this->assertSame((string)$sum,$daily['week']['totals']['gross_collected_php']);
            $this->assertSame($daily['week']['totals'],$weekly['totals']);$this->assertFalse($weekly['is_finalized']);
            $evidence['reports'][$key]=compact('daily','weekly');
            if($branch)$evidence['branches'][]=['id'=>$key,'publicId'=>$branch->public_id,'name'=>$branch->name];
        }
        $target=env('DENTALOPS_LOCAL_TARGET');$this->assertNotEmpty($target,'Explicit owned private runtime only.');
        $path=dirname($target).'/owner-dashboard-evidence.json';
        file_put_contents($path,json_encode($evidence,JSON_THROW_ON_ERROR));chmod($path,0600);
    }
}
