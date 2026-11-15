<?php
namespace Tests\Feature\Billing;
use App\Models\{Invoice,Payment,Receipt,ServicePrice};
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\{DB,Http};
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class PatientReceiptNavigationTest extends TestCase
{
 use DatabaseTransactions,SchedulingFixture;
 protected function setUp():void{parent::setUp();$this->setUpSchedulingWorld();Http::preventStrayRequests();DB::table('m11_billing_cutovers')->where('id',1)->update(['established_at'=>'2026-09-01 00:00:00+08']);ServicePrice::create(['service_id'=>$this->svc['svc1']->id,'branch_id'=>$this->b['b1']->id,'kind'=>'priced','amount'=>'125.50','effective_from'=>'2026-09-01','source'=>'owner_confirmed','created_by_user_id'=>$this->u['owner']->id,'created_at'=>now()]);}
 private function invoice(bool $scheduled=true,bool $pay=true):array{
  $this->actingAsUser('staffB1');$a=$scheduled?$this->existing('A','d1','b1','svc1','2026-09-28','11:00'):null;
  $v=$this->postJson($a?'/api/visits/check-in':'/api/visits/walk-in',$a?['appointment_id'=>$a->public_id,'expected_revision'=>1]:['patient_id'=>$this->p['A']->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d1'],['Idempotency-Key'=>'receipt-arrive'])->assertCreated()->json('data');
  $this->postJson('/api/queue/'.$v['queue']['id'].'/call',['expected_revision'=>1],['Idempotency-Key'=>'receipt-call'])->assertOk();$this->actingAsUser('dentist1');
  $t=$this->postJson('/api/visits/'.$v['id'].'/treatment',['expected_revision'=>1],['Idempotency-Key'=>'receipt-start'])->assertCreated()->json('data');
  $this->postJson('/api/treatments/'.$t['id'].'/document',['expected_revision'=>1,'procedure_summary'=>'Synthetic receipt context','prescription_required'=>false,'followup_required'=>false,'procedures'=>[['service_ref'=>'svc1','quantity'=>1]]],['Idempotency-Key'=>'receipt-document'])->assertOk();
  $this->postJson('/api/treatments/'.$t['id'].'/complete',['expected_revision'=>2],['Idempotency-Key'=>'receipt-complete'])->assertOk();$this->actingAsUser('staffB1');
  $i=$this->postJson('/api/invoices/from-treatment/'.$t['id'],[],['Idempotency-Key'=>'receipt-draft'])->assertCreated()->json('data');
  $this->postJson('/api/invoices/'.$i['id'].'/review',['expected_revision'=>1],['Idempotency-Key'=>'receipt-review'])->assertOk();
  $issued=$this->postJson('/api/invoices/'.$i['id'].'/issue',['expected_revision'=>2],['Idempotency-Key'=>'receipt-issue'])->assertOk()->json('data');
  $result=$pay?$this->postJson('/api/invoices/'.$i['id'].'/payment',['expected_revision'=>3,'method'=>'Cash','amount'=>'125.50'],['Idempotency-Key'=>'receipt-pay'])->assertOk()->json('data'):$issued;
  return [$result,$a?->public_id,$v['id']];
 }
 public function test_exact_appointment_filter_pdf_identity_and_new_signin_read_without_financial_mutation():void{
  [$i,$a,$v]=$this->invoice();$before=[Payment::count(),Receipt::count(),Invoice::sole()->histories()->count()];$this->actingAsUser('patientA');
  $this->getJson('/api/invoices/mine?appointment_id='.$a)->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$i['id'])->assertJsonPath('data.0.appointment_id',$a)->assertJsonPath('data.0.visit_id',$v)->assertJsonPath('data.0.receipt.id',$i['receipt']['id'])->assertJsonPath('data.0.balance','0.00');
  $pdf=$this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertOk()->assertHeader('X-Invoice-Id',$i['id'])->assertHeader('X-Patient-Id',$this->p['A']->public_id)->assertHeader('X-Receipt-Id',$i['receipt']['id']);self::assertStringStartsWith('%PDF-',$pdf->getContent());
  $this->app['auth']->forgetGuards();$this->actingAsUser('patientA');$this->getJson('/api/invoices/mine?appointment_id='.$a)->assertOk()->assertJsonPath('data.0.receipt.id',$i['receipt']['id']);
  $this->actingAsUser('patientB');$this->getJson('/api/invoices/mine?appointment_id='.$a)->assertOk()->assertJsonCount(0,'data');$this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertNotFound();
  self::assertSame($before,[Payment::count(),Receipt::count(),Invoice::sole()->histories()->count()]);
 }
 public function test_walkin_receipt_preserves_null_appointment_and_exact_saved_invoice_identity():void{
  [$i,$a,$v]=$this->invoice(false);self::assertNull($a);$this->actingAsUser('patientA');
  $this->getJson('/api/invoices/mine')->assertOk()->assertJsonPath('data.0.appointment_id',null)->assertJsonPath('data.0.visit_source','walk_in')->assertJsonPath('data.0.visit_id',$v)->assertJsonPath('data.0.receipt.id',$i['receipt']['id']);
  $this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertOk()->assertHeader('X-Receipt-Id',$i['receipt']['id']);self::assertSame(1,Payment::count());
 }
 public function test_unpaid_invoice_reads_and_pdf_requests_do_not_create_paid_status_or_receipt():void{
  [$i,$a]=$this->invoice(true,false);$this->actingAsUser('patientA');
  $this->getJson('/api/invoices/mine?appointment_id='.$a)->assertOk()->assertJsonPath('data.0.status','Issued')->assertJsonPath('data.0.receipt',null)->assertJsonPath('data.0.balance','125.50');
  $this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertNotFound();$this->get('/api/invoices/'.$i['id'].'/pdf')->assertOk()->assertHeader('X-Invoice-Id',$i['id']);
  self::assertSame(0,Payment::count());self::assertSame(0,Receipt::count());self::assertSame('Issued',Invoice::sole()->status);
 }
}
