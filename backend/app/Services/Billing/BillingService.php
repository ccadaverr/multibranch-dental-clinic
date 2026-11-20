<?php
namespace App\Services\Billing;
use App\Enums\Role;
use App\Models\{Appointment,BillingCutover,Invoice,InvoiceHistory,InvoiceLine,Payment,Receipt,Treatment,User,UserBranchScope};
use App\Services\Hmo\HmoFinancialGate;
use App\Services\Pricing\{PriceResolver,PriceUnavailable};
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;

final class BillingService {
    public function __construct(private readonly PriceResolver $prices, private readonly HmoFinancialGate $gate) {}
    public function treatments(User $actor) { return Treatment::visibleTo($actor)->where('status','Completed')->with(['visit.patient.person','visit.branch','procedures.service'])->get()->map(function (Treatment $t) { $missing=[]; foreach ($t->procedures as $line) { if ($this->prices->resolve($line->service,$t->visit->branch,$t->visit->clinic_date->format('Y-m-d')) instanceof PriceUnavailable) $missing[]=['line_no'=>$line->line_no,'service'=>$line->service->legacy_ref,'name'=>$line->service->name]; } $invoice=Invoice::where('treatment_id',$t->id)->first(); return ['treatment'=>$t,'invoice'=>$invoice,'billing_state'=>$invoice?'already_invoiced':($missing?'pricing_unavailable':'ready_for_draft'),'pricing_unavailable'=>$missing]; }); }
    public function createDraft(User $actor,Treatment $treatment): Invoice {
        $this->staffBranch($actor,$treatment->visit->branch_id);
        return DB::transaction(function() use($actor,$treatment){
            $t=Treatment::whereKey($treatment->id)->lockForUpdate()->with(['visit.patient','visit.branch','procedures.service'])->firstOrFail();
            if($t->status!=='Completed') throw new BillingException(422,'invalid_treatment_status','Only completed Treatments can be billed.');
            $cut=BillingCutover::query()->firstOrFail(); if(!$t->completed_at || $t->completed_at->lt($cut->established_at)) throw new BillingException(422,'treatment_before_cutover','This Treatment was completed before M11 billing became authoritative.');
            if($existing=Invoice::where('treatment_id',$t->id)->with(['lines','payment','receipt'])->first()) return $existing;
            $gross='0.00'; $rows=[]; $fail=[];
            foreach($t->procedures as $line){ $resolved=$this->prices->resolve($line->service,$t->visit->branch,$t->visit->clinic_date->format('Y-m-d')); if($resolved instanceof PriceUnavailable){$fail[]=['line_no'=>$line->line_no,'service'=>$line->service->legacy_ref,'name'=>$line->service->name];continue;} $unit=$resolved->amount(); $total=$this->mul($unit,$line->quantity); $gross=$this->add($gross,$total); $rows[]=['line'=>$line,'resolved'=>$resolved,'unit'=>$unit,'total'=>$total]; }
            if($fail) throw new BillingException(422,'pricing_unavailable','Authoritative pricing is required before creating this invoice.', ['services'=>$fail]);
            $n=DB::selectOne("select nextval('m11_invoice_number_seq') as n")->n; $number='INV-'.ClinicClock::now()->format('Y').'-'.str_pad((string)$n,6,'0',STR_PAD_LEFT);
            $invoice=Invoice::create(['treatment_id'=>$t->id,'visit_id'=>$t->visit_id,'patient_id'=>$t->visit->patient_id,'branch_id'=>$t->visit->branch_id,'invoice_number'=>$number,'status'=>'Draft','revision'=>1,'gross_amount'=>$gross,'hmo_coverage_amount'=>'0.00','patient_responsibility_amount'=>$gross,'paid_amount'=>'0.00','created_by_user_id'=>$actor->id,'updated_by_user_id'=>$actor->id]);
            foreach($rows as $i=>$r) InvoiceLine::create(['invoice_id'=>$invoice->id,'service_id'=>$r['line']->service_id,'service_price_id'=>$r['resolved']->version->id,'line_no'=>$i+1,'service_code'=>$r['line']->service_code,'service_name'=>$r['line']->service_name,'quantity'=>$r['line']->quantity,'unit_price'=>$r['unit'],'line_total'=>$r['total']]);
            $this->history($invoice,$actor,'invoice.created',null,'Draft'); return $invoice->load(['lines','treatment','visit.patient.person','branch','payment','receipt','histories']);
        },3);
    }
    public function transition(User $actor, Invoice $invoice, string $to, int $expected): Invoice
    {
        $this->staffBranch($actor, $invoice->branch_id);

        return DB::transaction(function () use ($actor, $invoice, $to, $expected) {
            $i = Invoice::whereKey($invoice->id)->lockForUpdate()->with(['patient.person', 'patient.user', 'visit'])->firstOrFail();
            if ($i->revision !== $expected) {
                throw new BillingException(409, 'stale_revision', 'Invoice changed; reload before continuing.');
            }
            if ($to === 'Review') {
                if ($i->status !== 'Draft') {
                    throw new BillingException(422, 'invalid_invoice_state', 'Only Draft invoices can be reviewed.');
                }
                $i->update(['status' => 'Review', 'revision' => $i->revision + 1, 'updated_by_user_id' => $actor->id]);
                $this->history($i, $actor, 'invoice.reviewed', 'Draft', 'Review');

                return $i->fresh(['lines', 'histories']);
            }
            if ($to !== 'Issued' || $i->status !== 'Review') {
                throw new BillingException(422, 'invalid_invoice_state', 'Only Review invoices can be issued.');
            }
            $gate = $this->gate->forTreatment($i->treatment()->firstOrFail());
            if ($gate['blocks_invoice_issue']) {
                throw new BillingException(422, 'hmo_financial_hold', 'HMO financial decision is required before issuing this invoice.', ['gate' => $gate]);
            }
            $discount = (string) ($i->discount_amount ?? '0.00');
            $net = $this->sub((string) $i->gross_amount, $discount);
            $coverage = $gate['coverage_status'] === 'approved' ? $this->min((string) $gate['approved_amount'], $net) : '0.00';
            $responsibility = $this->sub($net, $coverage);
            $allocation = $this->bookingAllocation($i, $responsibility);
            $paid = $allocation['applied_php'] ?? '0.00';
            $status = $paid === $responsibility ? 'Paid' : 'Issued';
            $settlement = match (true) {
                $responsibility === '0.00' => 'full_hmo_coverage',
                $status === 'Paid' => 'booking_deposit',
                $paid !== '0.00' => 'partial_booking_deposit',
                default => null,
            };
            $now = ClinicClock::now();
            $i->update([
                'status' => $status, 'billed_to_name' => $i->patient?->person?->fullName(),
                'revision' => $i->revision + 1, 'hmo_status' => $gate['status'], 'hmo_approved_amount' => $gate['approved_amount'],
                'hmo_coverage_amount' => $coverage, 'patient_responsibility_amount' => $responsibility, 'paid_amount' => $paid,
                'settlement_type' => $settlement, 'issued_at' => $now, 'paid_at' => $status === 'Paid' ? $now : null,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->history($i, $actor, 'invoice.issued', 'Review', $status, $settlement, $allocation);
            if ($status === 'Issued' || $settlement === 'booking_deposit') {
                app(\App\Services\Notifications\NotificationCenter::class)->invoiceIssued($i);
                try {
                    app(\App\Services\Mail\MailOutbox::class)->queue(
                        'invoice_issued', "invoice_issued:{$i->public_id}", $i, null, $i->patient?->contactUser(), $actor
                    );
                } catch (\Throwable $e) {
                    report($e);
                }
            }
            $action = match ($settlement) {
                'full_hmo_coverage' => 'billing.invoice_settled_by_hmo',
                'booking_deposit' => 'billing.invoice_settled_by_booking_deposit',
                default => 'billing.invoice_issued',
            };
            $this->audit($actor, $action, $i, [
                'invoice_number' => $i->invoice_number, 'gross_amount' => (string) $i->gross_amount,
                'discount_amount' => $discount, 'hmo_coverage_amount' => $coverage, 'patient_responsibility_amount' => $responsibility,
                'paid_amount' => $paid, 'settlement_type' => $settlement, 'booking_credit' => $allocation,
            ]);

            return $i->fresh(['lines', 'histories', 'payment', 'receipt']);
        }, 3);
    }

    /** Read the exact original capture under lock. Invoice issue only allocates credit. */
    private function bookingAllocation(Invoice $invoice, string $responsibility): ?array
    {
        $appointmentId = $invoice->visit?->appointment_id;
        if (! $appointmentId) {
            return null;
        }
        $appointment = Appointment::whereKey($appointmentId)->lockForUpdate()->firstOrFail();
        if ($appointment->booking_payment_status === 'partially_refunded') {
            throw new BillingException(422, 'booking_credit_unverified', 'The remaining booking deposit must be reconciled before issuing this invoice.');
        }
        if ($appointment->booking_payment_status !== 'paid') {
            return null;
        }
        if ($appointment->booking_refund_ref || \App\Models\AuditLog::where('auditable_type', 'Appointment')
            ->where('auditable_public_id', $appointment->public_id)
            ->where('action', 'billing.booking_refund_attempt_started')->exists()) {
            throw new BillingException(422, 'booking_refund_reconciliation_required',
                'A booking deposit refund was requested or its outcome is uncertain. Reconcile the original capture before issuing this invoice.');
        }
        if ($appointment->patient_id !== $invoice->patient_id || $appointment->branch_id !== $invoice->branch_id
            || ! $appointment->booking_payment_ref || ! $appointment->booking_paid_at || $this->cents((string) ($appointment->booking_fee_php ?? 0)) === 0) {
            throw new BillingException(422, 'booking_credit_unverified', 'The original booking payment must be reconciled before issuing this invoice.');
        }
        // The database permits one visit per appointment, one treatment per visit,
        // and one invoice per treatment. The issue revision guards against reuse.
        $captured = (string) $appointment->booking_fee_php;
        $available = $this->cents($captured);
        $applied = min($available, $this->cents($responsibility));

        return [
            'appointment_id' => $appointment->public_id,
            'receipt_number' => $appointment->appointment_code ? 'DEP-'.$appointment->appointment_code : null,
            'captured_at' => $appointment->booking_paid_at->toIso8601String(),
            'captured_php' => $captured,
            'applied_php' => $this->dec($applied),
            'unapplied_php' => $this->dec($available - $applied),
        ];
    }

    public function applyDiscount(User $actor,Invoice $invoice,?string $type,?string $idNumber,int $expected):Invoice {
        $this->staffBranch($actor,$invoice->branch_id);
        return DB::transaction(function() use ($actor,$invoice,$type,$idNumber,$expected) {
            $i=Invoice::whereKey($invoice->id)->lockForUpdate()->with(['lines','treatment','visit.patient.person','branch','payment','receipt','histories'])->firstOrFail();
            if($i->revision!==$expected) throw new BillingException(409,'stale_revision','Invoice changed; reload before continuing.');
            if(!in_array($i->status,['Draft','Review'],true)) throw new BillingException(422,'invalid_invoice_state','Discounts can only be applied to Draft or Review invoices.');
            if($type===null) {
                $resp=$this->sub((string)$i->gross_amount,(string)$i->hmo_coverage_amount);
                $i->update(['discount_type'=>null,'discount_id_number'=>null,'discount_amount'=>'0.00','patient_responsibility_amount'=>$resp,'revision'=>$i->revision+1,'updated_by_user_id'=>$actor->id]);
                $this->history($i,$actor,'invoice.discount_removed',$i->status,$i->status);
                $this->audit($actor,'billing.discount_removed',$i,['invoice_number'=>$i->invoice_number]);
            } else {
                if(!in_array($type,['Senior Citizen','PWD'],true)) throw new BillingException(422,'invalid_discount_type','Discount type must be Senior Citizen or PWD.');
                if(empty(trim((string)$idNumber))) throw new BillingException(422,'missing_id_number','ID number is required for statutory discounts.');
                $grossCents=$this->cents((string)$i->gross_amount);
                $discountCents=(int) round($grossCents * 0.20);
                $discountAmount=$this->dec($discountCents);
                $coverageCents=$this->cents((string)$i->hmo_coverage_amount);
                $respCents=max(0,$grossCents-$discountCents-$coverageCents);
                $resp=$this->dec($respCents);
                $i->update(['discount_type'=>$type,'discount_id_number'=>trim((string)$idNumber),'discount_amount'=>$discountAmount,'patient_responsibility_amount'=>$resp,'revision'=>$i->revision+1,'updated_by_user_id'=>$actor->id]);
                $this->history($i,$actor,'invoice.discount_applied',$i->status,$i->status);
                $this->audit($actor,'billing.discount_applied',$i,['invoice_number'=>$i->invoice_number,'discount_type'=>$type,'discount_id_number'=>trim((string)$idNumber),'discount_amount'=>$discountAmount]);
            }
            return $i->fresh(['lines','treatment','visit.patient.person','branch','payment','receipt','histories']);
        },3);
    }
    /**
     * The one server check that an invoice may take a payment NOW, shared by the Staff-recorded payment, the online checkout and
     * the provider settlement so they can never disagree. Returns the exact amount owed (decimal string). The invoice must be
     * Issued, the M12 financial gate must not hold payment, the HMO outcome must be unchanged since issue, and a balance must
     * remain. Full payment only: there is no partial, split or over-payment.
     */
    public function payableBalance(Invoice $i, ?string $submittedAmount = null): string
    {
        if ($i->status !== 'Issued') {
            throw new BillingException(422, $i->status === 'Paid' ? 'already_paid' : 'invalid_invoice_state', 'This invoice is not payable.');
        }
        $gate = $this->gate->forTreatment($i->treatment()->firstOrFail());
        if ($gate['blocks_payment']) {
            throw new BillingException(422, 'hmo_financial_hold', 'HMO financial decision is required before payment.', ['gate' => $gate]);
        }
        $current = $gate['coverage_status'] === 'approved' ? $this->min((string) ($gate['approved_amount'] ?? '0.00'), (string) $i->gross_amount) : '0.00';
        $balance = $this->sub((string) $i->patient_responsibility_amount, (string) $i->paid_amount);
        if ($submittedAmount !== null && $this->cents($submittedAmount) !== $this->cents($balance)) {
            throw new BillingException(422, 'invalid_payment_amount', 'Payment must equal the full current balance.');
        }
        if ($current !== (string) $i->hmo_coverage_amount || (string) ($gate['status'] ?? '') !== (string) ($i->hmo_status ?? '')) {
            throw new BillingException(409, 'financial_state_changed', 'HMO coverage changed after issue. Keep this invoice on hold for an authorized correction before recording payment.');
        }
        if ($balance === '0.00') {
            throw new BillingException(422, 'already_paid', 'This invoice is already settled.');
        }

        return $balance;
    }

    /** Whole centavos for a provider API from a validated decimal string — integer arithmetic only, never a float. */
    public function centavos(string $amount): int
    {
        return $this->cents($amount);
    }

    public function pay(User $actor, Invoice $invoice, int $expected, string $method, ?string $reference, ?string $submittedAmount = null): Invoice
    {
        return DB::transaction(function () use ($actor, $invoice, $expected, $method, $reference, $submittedAmount) {
            $actor = $this->lockFinancialActor($actor, $invoice, Role::Staff);
            $i = Invoice::whereKey($invoice->id)->lockForUpdate()->with(['lines', 'visit.patient.person', 'payment', 'receipt', 'branch'])->firstOrFail();
            if ($i->revision !== $expected) {
                throw new BillingException(409, 'stale_revision', 'Invoice changed; reload before continuing.');
            }
            $balance = $this->payableBalance($i, $submittedAmount);
            if ($i->openCheckouts()->exists()) {
                throw new BillingException(409, 'checkout_reconciliation_required',
                    'An online checkout is still open. Check the provider status before collecting payment at the counter.');
            }
            if (in_array($method, ['Card/POS', 'Bank Transfer', 'E-Wallet'], true) && ! $reference) {
                throw new BillingException(422, 'invalid_payment_reference', 'An external reference is required for this payment method.');
            }
            $this->settle($i, $actor, $balance, $method, $reference, 'invoice.paid', null);

            return $i->fresh(['lines', 'histories', 'payment', 'receipt', 'visit.patient.person', 'branch']);
        }, 3);
    }

    /** Hold current account and branch authority through both a financial work request and its replay. */
    public function lockFinancialActor(User $actor, Invoice $invoice, Role $role): User
    {
        $current = User::whereKey($actor->id)->where('role', $role->value)->where('auth_version', $actor->auth_version)
            ->where('account_status', 'Active')->whereNull('deleted_at')->sharedLock()->first();
        if (! $current) {
            throw new BillingException(403, 'forbidden', 'This account cannot perform that financial action.');
        }
        if ($role === Role::Staff && ! UserBranchScope::where('user_id', $current->id)
            ->where('branch_id', $invoice->branch_id)->sharedLock()->first()) {
            throw new BillingException(403, 'forbidden', 'Staff branch access is required.');
        }

        return $current;
    }

    /** Records operational review in the existing immutable invoice history. Settlement evidence stays intact. */
    public function recordCashCorrectionReview(User $actor, Invoice $invoice, int $expected, ?string $reason): Invoice
    {
        return DB::transaction(function () use ($actor, $invoice, $expected, $reason) {
            $requesting = $reason !== null;
            $actor = $this->lockFinancialActor($actor, $invoice, $requesting ? Role::Staff : Role::Owner);
            $i = Invoice::whereKey($invoice->id)->lockForUpdate()->with(['payment', 'receipt', 'histories', 'visit'])->firstOrFail();
            if ($i->revision !== $expected) {
                throw new BillingException(409, 'stale_revision', 'Invoice changed; reload before continuing.');
            }
            if (! $i->cashSettlementRecorded() || $i->visit?->patient_id !== $i->patient_id || $i->visit?->branch_id !== $i->branch_id) {
                throw new BillingException(422, 'cash_evidence_unavailable', 'A verified Cash collection and its original Payment Receipt are required.');
            }
            $review = $i->cashCorrectionReview();
            if ($requesting && ! in_array($reason, InvoiceHistory::CASH_REVIEW_REASONS, true)) {
                throw new BillingException(422, 'invalid_cash_review_reason', 'Choose a reason for financial review.');
            }
            if ($requesting ? $review !== null : $review?->event !== InvoiceHistory::CASH_REVIEW_REQUESTED) {
                throw new BillingException(422, 'cash_review_state_changed', 'This Cash collection already has a review record, or no request is awaiting acknowledgement.');
            }
            $event = $requesting ? InvoiceHistory::CASH_REVIEW_REQUESTED : InvoiceHistory::CASH_REVIEW_ACKNOWLEDGED;
            $snapshot = [
                'reason' => $reason ?? $review->snapshot['reason'],
                'payment_id' => $i->payment->public_id,
                'receipt_id' => $i->receipt->public_id,
                'receipt_number' => $i->receipt->receipt_number,
                'original_amount' => $i->payment->amount,
            ];
            $i->update(['revision' => $i->revision + 1, 'updated_by_user_id' => $actor->id]);
            $i->histories()->create([
                'event' => $event, 'from_status' => 'Paid', 'to_status' => 'Paid', 'snapshot' => $snapshot,
                'actor_user_id' => $actor->id, 'occurred_at' => ClinicClock::now(),
            ]);
            $this->audit($actor, 'billing.'.substr($event, strlen('invoice.')), $i, $snapshot);

            return $i->fresh();
        }, 3);
    }

    /**
     * Applies a provider-captured payment that the webhook handler has ALREADY verified (a session this server created, the
     * provider's own report of the amount, the exact balance). Replaying the same provider payment id returns the existing
     * settlement; a different provider payment for an already-paid invoice is refused (the handler records it for review).
     */
    public function payOnline(Invoice $invoice, string $method, string $providerPaymentId, User $actor, string $expectedAmount): Invoice
    {
        return DB::transaction(function () use ($invoice, $method, $providerPaymentId, $actor, $expectedAmount) {
            $i = Invoice::whereKey($invoice->id)->lockForUpdate()->with(['lines', 'visit.patient.person', 'patient.person', 'payment', 'receipt', 'branch'])->firstOrFail();
            if ($i->status === 'Paid' && $i->payment?->external_reference === $providerPaymentId
                && $i->payment->method === $method && $this->cents($i->payment->amount) === $this->cents($expectedAmount)
                && $i->receipt?->payment_id === $i->payment->id) {
                return $i; // the same provider payment replayed
            }
            $balance = $this->payableBalance($i);
            if ($this->cents($balance) !== $this->cents($expectedAmount)) {
                throw new BillingException(422, 'amount_mismatch', 'The captured amount does not equal the current balance.');
            }
            $this->settle($i, $actor, $balance, $method, $providerPaymentId, 'invoice.paid', 'online_paymongo');
            // M23 ledger event (one per invoice; a replay returns the existing event). It runs in its own savepoint and can never
            // undo a payment the provider has already captured; a failure is reported, not swallowed.
            try {
                DB::transaction(fn () => app(\App\Services\Automation\WorkflowAutomationService::class)->recordEvent([
                    'event_type' => 'billing.payment_received', 'domain' => 'billing', 'aggregate_type' => 'Invoice', 'aggregate_id' => $i->public_id,
                    'branch_id' => $i->branch_id, 'actor_user_id' => $actor->id, 'idempotency_key' => 'billing.payment_received:'.$i->public_id,
                    'payload' => ['invoice_number' => $i->invoice_number, 'amount' => $balance, 'method' => $method],
                ]));
            } catch (\Throwable $e) {
                report($e);
            }

            return $i->fresh(['lines', 'histories', 'payment', 'receipt', 'visit.patient.person', 'branch']);
        }, 3);
    }

    /** Payment + Receipt + invoice Paid + history + M22 audit, in the caller's transaction (full payment only). */
    private function settle(Invoice $i, User $actor, string $balance, string $method, ?string $reference, string $event, ?string $settlementType): void
    {
        // Invoice paid_amount includes the booking credit already applied at issue. Payment/Receipt record only this collection.
        $now = ClinicClock::now();
        $paid = $this->add((string) $i->paid_amount, $balance);
        $payment = Payment::create(['invoice_id' => $i->id, 'amount' => $balance, 'method' => $method, 'external_reference' => $reference, 'recorded_by_user_id' => $actor->id, 'recorded_at' => $now]);
        $rn = DB::selectOne("select nextval('m11_receipt_number_seq') as n")->n;
        $receipt = Receipt::create(['received_from_name' => $i->billed_to_name ?? ($i->patient?->person ? trim($i->patient->person->first_name.' '.$i->patient->person->last_name) : null), 'payment_id' => $payment->id, 'invoice_id' => $i->id, 'receipt_number' => 'RCT-'.$now->format('Y').'-'.str_pad((string) $rn, 6, '0', STR_PAD_LEFT), 'amount' => $balance, 'method' => $method, 'external_reference' => $reference, 'issued_at' => $now]);
        $i->update(['status' => 'Paid', 'paid_amount' => $paid, 'paid_at' => $now, 'revision' => $i->revision + 1, 'updated_by_user_id' => $actor->id]);
        $this->history($i, $actor, $event, 'Issued', 'Paid', $settlementType);
        // Inside the transaction: a payment recorded by Staff and its audit event commit or roll back together. (The provider
        // path never undoes captured funds: the webhook handler stores the provider event first and reconciles from it.)
        $this->audit($actor, 'billing.payment_recorded', $i, ['invoice_number' => $i->invoice_number, 'receipt_number' => $receipt->receipt_number, 'amount' => $balance, 'method' => $method]);
        app(\App\Services\Notifications\NotificationCenter::class)->paymentReceived($i, $receipt);
        // M18: the courtesy receipt email is a durable intent written in this same transaction (so it exists only if the
        // payment does); the worker sends it after commit and retries within its limit. It never undoes the payment.
        try {
            app(\App\Services\Mail\MailOutbox::class)->queue('payment_receipt', "payment_receipt:{$receipt->public_id}", $receipt, null, $i->patient?->contactUser(), $actor);
        } catch (\Throwable $e) {
            report($e); // the intent is written inside a savepoint, so a failure here is reported and the payment still commits
        }
    }

    private function audit(User $actor, string $action, Invoice $i, array $payload): void
    {
        app(\App\Services\Audit\AuditService::class)->record([
            'action' => $action, 'category' => 'financial', 'severity' => 'info', 'actor' => $actor, 'target' => $i, 'branch_id' => $i->branch_id,
            // Decimal-safe strings and public identifiers only: no provider reference, credential or raw provider payload.
            'payload' => $payload,
        ]);
    }

    private function history(Invoice $i,User $a,string $event,?string $from,?string $to,?string $settlement=null,?array $bookingCredit=null):void{InvoiceHistory::create(['invoice_id'=>$i->id,'event'=>$event,'from_status'=>$from,'to_status'=>$to,'settlement_type'=>$settlement,'snapshot'=>(['gross_amount'=>(string)$i->gross_amount,'discount_amount'=>(string)($i->discount_amount??'0.00'),'hmo_coverage_amount'=>(string)$i->hmo_coverage_amount,'patient_responsibility_amount'=>(string)$i->patient_responsibility_amount,'paid_amount'=>(string)$i->paid_amount] + ($bookingCredit ? ['booking_credit' => $bookingCredit] : [])),'actor_user_id'=>$a->id,'occurred_at'=>ClinicClock::now()]);}
    private function staffBranch(User $a,int $branch):void{if($a->role!==Role::Staff||!UserBranchScope::where('user_id',$a->id)->where('branch_id',$branch)->exists())throw new BillingException(403,'forbidden','Staff branch access is required.');}
    private function cents(string $v):int{$v=trim($v);if(!preg_match('/^\d+(?:\.\d{1,2})?$/',$v))throw new BillingException(500,'invalid_decimal','Invalid stored financial decimal.');$p=explode('.',$v);return ((int)$p[0])*100+(int)str_pad($p[1]??'0',2,'0');}
    private function dec(int $c):string{return number_format($c/100,2,'.','');}
    private function add(string $a,string $b):string{return $this->dec($this->cents($a)+$this->cents($b));} private function sub(string $a,string $b):string{return $this->dec($this->cents($a)-$this->cents($b));} private function mul(string $a,int $q):string{return $this->dec($this->cents($a)*$q);} private function min(string $a,string $b):string{return $this->dec(min($this->cents($a),$this->cents($b)));}
}
