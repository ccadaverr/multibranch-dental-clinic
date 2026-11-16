<?php

namespace Tests\Feature\Inquiries;

use App\Models\{CommandKey, Inquiry, InquiryHistory, StaffProfile, UserBranchScope};
use App\Services\Inquiries\InquiryService;
use App\Services\Visits\VisitCommandException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class InquiryAssignmentReplayTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_a_cached_capture_receipt_cannot_bypass_current_assignment(): void
    {
        $this->setUpSchedulingWorld();
        $actor = $this->u['staffB1'];
        $profile = StaffProfile::create(['legacy_ref' => 'inquiry-replay', 'person_id' => $actor->person_id, 'branch_id' => $this->b['b1']->id,
            'title' => 'Reception', 'shift_start' => '09:00', 'shift_end' => '17:00', 'available' => true]);
        UserBranchScope::firstOrCreate(['user_id' => $actor->id, 'branch_id' => $this->b['b2']->id]);
        $service = app(InquiryService::class);
        $create = fn () => $service->create($actor, $this->b['b1'], 'Facebook', 'Synthetic contact', null, 'Synthetic question', 'same-inquiry-receipt');
        self::assertSame(201, $create()->getStatusCode());
        $before = Inquiry::sole()->getAttributes();
        $profile->update(['branch_id' => $this->b['b2']->id]);
        try {
            $create();
            self::fail('A committed receipt must not bypass the current branch assignment.');
        } catch (VisitCommandException $exception) {
            self::assertSame(403, $exception->status);
        }
        self::assertSame($before, Inquiry::sole()->getAttributes());
        self::assertSame(1, InquiryHistory::count());
        self::assertSame(1, CommandKey::where('command', 'inquiry.create')->count());
    }
}
