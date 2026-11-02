<?php

namespace Tests\Feature\Reference;

use App\Models\AssistantAnswer;
use App\Models\AuditLog;
use App\Models\BranchClosure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PublicContentPublicationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    public function test_only_active_confirmed_global_faq_entries_are_public_and_owner_can_withdraw_publication(): void
    {
        $this->actingAsUser('owner');
        $id = $this->postJson('/api/assistant-answers', [
            'question' => 'Fictional publication acceptance question?', 'answer' => 'Fictional owner-reviewed answer.', 'category' => 'other', 'draft' => true,
        ])->assertCreated()->json('data.id');
        $this->getJson('/api/public/faq')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/assistant-answers/{$id}", ['expected_revision' => 1, 'draft' => false])->assertOk();
        $this->getJson('/api/public/faq')->assertOk()->assertJsonPath('data.0.id', $id);
        AssistantAnswer::create(['question' => 'Fictional branch-specific question?', 'answer' => 'Branch-only answer.', 'category' => 'other', 'draft' => false, 'active' => true, 'branch_id' => $this->b['b1']->id]);
        $this->patchJson("/api/assistant-answers/{$id}", ['expected_revision' => 2, 'active' => false])->assertOk();
        $this->getJson('/api/public/faq')->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame(2, AssistantAnswer::count(), 'withdrawal retains records');
        $this->assertTrue(AuditLog::where('action', 'assistant.answer.deactivated')->exists());
    }

    public function test_patients_staff_and_dentists_cannot_publish_faqs_or_closures(): void
    {
        foreach (['patientA', 'staffB1', 'dentist1'] as $actor) {
            $this->actingAsUser($actor);
            $this->postJson('/api/assistant-answers', ['question' => 'Fictional question?', 'answer' => 'Fictional answer.', 'category' => 'other', 'draft' => false])->assertForbidden();
            $this->postJson('/api/branch-closures', ['branch_ref' => 'b1', 'date' => '2026-09-30', 'reason' => 'Fictional closure'])->assertForbidden();
        }
        $this->assertSame(0, AssistantAnswer::count());
        $this->assertSame(0, BranchClosure::count());
    }

    public function test_owner_closure_reasons_are_public_immediately_and_removal_preserves_the_record(): void
    {
        $this->actingAsUser('owner');
        $id = $this->postJson('/api/branch-closures', ['branch_ref' => 'b1', 'date' => '2026-09-30', 'reason' => 'Fictional owner-confirmed closure'])
            ->assertCreated()->json('data.id');
        BranchClosure::create(['branch_id' => null, 'closed_on' => '2026-10-01', 'reason' => 'Fictional suggestion', 'status' => 'suggested', 'source' => 'holiday_suggestion']);
        $this->getJson('/api/public/closures')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.reason', 'Fictional owner-confirmed closure');
        $this->patchJson("/api/branch-closures/{$id}", ['action' => 'remove'])->assertOk();
        $this->getJson('/api/public/closures')->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame('removed', BranchClosure::where('public_id', $id)->sole()->status);
        $this->assertTrue(AuditLog::where('action', 'branch_closure.removeed')->exists());
    }

    public function test_public_cancellation_copy_does_not_promise_unrestricted_cancellation_or_refunds(): void
    {
        \App\Models\AutomationSetting::findOrFail('attendance_policy')->update(['enabled' => true]);
        $policy = $this->getJson('/api/public/faq')->assertOk()->json('meta.cancellation_policy');
        $this->assertStringContainsString('before your appointment starts and before check-in', $policy);
        $this->assertStringContainsString('cancellation does not guarantee a refund', $policy);
        $this->assertStringNotContainsString('anytime', $policy);
        $this->assertStringNotContainsString('There are no fees', $policy);
    }

    public function test_accepted_hmos_require_owner_verification_and_active_publication(): void
    {
        $this->actingAsUser('staffB1');
        $this->postJson('/api/accepted-hmos', ['name' => 'Fictional HMO'])->assertForbidden();
        $this->actingAsUser('owner');
        $id = $this->postJson('/api/accepted-hmos', ['name' => 'Fictional HMO'])->assertCreated()->json('data.id');
        $this->getJson('/api/public/hmos')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/accepted-hmos/{$id}", ['expected_revision' => 1, 'verified' => true])->assertOk();
        $this->getJson('/api/public/hmos')->assertOk()->assertJsonPath('data.0.name', 'Fictional HMO');
        $this->patchJson("/api/accepted-hmos/{$id}", ['expected_revision' => 2, 'active' => false])->assertOk();
        $this->getJson('/api/public/hmos')->assertOk()->assertJsonCount(0, 'data');
    }
}
