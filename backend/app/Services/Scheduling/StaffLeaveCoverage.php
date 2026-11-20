<?php

namespace App\Services\Scheduling;

use App\Models\Branch;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Read-only evidence for an Owner's Staff leave decision. This is not a staffing minimum,
 * leave entitlement, automatic approval or proof that a colleague is assigned to cover.
 * Published duty, active accounts, current branch scopes and pending/approved leave are all required.
 */
final class StaffLeaveCoverage
{
    private const MAX_DAYS = 14;

    public function review(LeaveRequest $leave): array
    {
        $base = [
            'leave_id' => $leave->public_id, 'revision' => $leave->revision,
            'assessment' => 'unverified', 'window_count' => 0,
            'fully_matched_windows' => 0, 'partially_matched_windows' => 0, 'unmatched_windows' => 0,
            'truncated' => false, 'windows' => [],
            'policy' => 'Published coworker hours are possible alternatives, not confirmed replacement assignments or an approved staffing minimum. Pending and approved coworker leave are treated as unavailable. Only the Owner decides leave.',
        ];
        if (! $leave->staff_profile_id) return $base + ['reason' => 'Only Staff leave uses published Staff roster coverage. Dentist leave is reviewed against booked appointments.'];
        $requesterProfileId = (int) $leave->staff_profile_id;
        if (! Schema::hasTable('staff_roster_publications') || ! Schema::hasTable('staff_roster_drafts')) {
            return array_replace($base, ['reason' => 'Published Staff duty is unavailable. The Owner must review coverage independently.']);
        }

        $start = ClinicClock::local($leave->starts_at);
        $end = ClinicClock::local($leave->ends_at);
        $lastDate = $end->subMicrosecond()->toDateString(); // End is exclusive, including midnight.
        $firstDate = $start->toDateString();
        $dayCount = 1 + (int) $start->startOfDay()->diffInDays(ClinicClock::at($lastDate, '00:00'));
        $previewDays = min($dayCount, self::MAX_DAYS);
        $base['truncated'] = $dayCount > self::MAX_DAYS;
        $base['reviewed_dates'] = $previewDays;

        // Only currently active, non-deleted Staff with actual branch authority can be suggested.
        $users = User::where('role', 'staff')->where('account_status', 'Active')->get(['id', 'person_id']);
        $staff = StaffProfile::whereIn('person_id', $users->pluck('person_id'))->get(['id', 'person_id']);
        $byPerson = $staff->keyBy('person_id');
        $profileIds = $staff->pluck('id')->push($requesterProfileId)->unique()->values();
        $scopeByUser = UserBranchScope::whereIn('user_id', $users->pluck('id'))->get(['user_id', 'branch_id'])->groupBy('user_id');
        $eligible = []; // staff_profile_id => authorized branch IDs
        foreach ($users as $user) {
            $profile = $byPerson->get($user->person_id);
            if ($profile && (int) $profile->id !== $requesterProfileId) {
                $eligible[$profile->id] = ($scopeByUser->get($user->id) ?? collect())->pluck('branch_id')->all();
            }
        }
        $plans = DB::table('staff_roster_drafts as d')
            ->join('staff_roster_publications as p', 'p.id', '=', 'd.publication_id')
            ->whereIn('d.staff_profile_id', $profileIds)
            ->get(['d.staff_profile_id', 'p.public_id', 'p.snapshot'])
            ->groupBy('staff_profile_id')->map(fn ($rows) => $rows->map(function ($row) {
                $snapshot = json_decode($row->snapshot, true, 512, JSON_THROW_ON_ERROR);
                return $snapshot + ['publication_id' => $row->public_id];
            })->all())->all();
        $ownerPlans = $plans[$requesterProfileId] ?? [];
        if (! $ownerPlans) return array_replace($base, ['reason' => 'No published duty for the requester. A profile shift is not evidence of a weekly Staff schedule.']);

        $refs = collect($plans)->flatten(1)->pluck('branch_ref')->filter()->unique()->values();
        $branches = Branch::whereIn('legacy_ref', $refs)->get()->keyBy('legacy_ref');
        $leaveRows = LeaveRequest::whereIn('staff_profile_id', array_keys($eligible))
            ->whereIn('status', ['Approved', 'Pending'])->where('starts_at', '<', $leave->ends_at)
            ->where('ends_at', '>', $leave->starts_at)->get()->groupBy('staff_profile_id');
        $duty = app(StaffDuty::class);
        $rows = [];
        $matched = 0; $partial = 0; $unmatched = 0;
        for ($offset = 0; $offset < $previewDays; $offset++) {
            $date = ClinicClock::addDays($firstDate, $offset);
            $dayStart = ClinicClock::at($date, '00:00');
            $startMin = max(0, (int) (($start->getTimestamp() - $dayStart->getTimestamp()) / 60));
            $endMin = min(1440, (int) (($end->getTimestamp() - $dayStart->getTimestamp()) / 60));
            if ($startMin >= $endMin) continue;
            $requesterWindows = $duty->scheduled($ownerPlans, $date);
            $coworkerWindows = [];
            foreach ($eligible as $profileId => $branchIds) {
                $available = [];
                foreach ($duty->scheduled($plans[$profileId] ?? [], $date) as $window) {
                    $branch = $branches->get($window['branch_ref']);
                    if (! $branch || ! in_array($branch->id, $branchIds, true)) continue;
                    $available[$window['branch_ref']][] = [ClinicClock::minutes($window['start_time']), ClinicClock::minutes($window['end_time'])];
                }
                $approvedLeave = [];
                foreach ($leaveRows->get($profileId) ?? [] as $away) {
                    $approvedLeave[] = [
                        max(0, (int) floor((ClinicClock::local($away->starts_at)->getTimestamp() - $dayStart->getTimestamp()) / 60)),
                        min(1440, (int) ceil((ClinicClock::local($away->ends_at)->getTimestamp() - $dayStart->getTimestamp()) / 60)),
                    ];
                }
                foreach ($available as $ref => $windows) {
                    foreach (StaffCoverageIntervals::subtract($windows, $approvedLeave) as $window) {
                        $coworkerWindows[$ref][] = $window;
                    }
                }
            }
            foreach ($requesterWindows as $window) {
                $branch = $branches->get($window['branch_ref']);
                if (! $branch || $branch->status !== 'Open') continue;
                $hours = $branch->hoursOnDate($date);
                if (! $hours) continue;
                $from = max($startMin, ClinicClock::minutes($window['start_time']), ClinicClock::minutes($hours['open']));
                $until = min($endMin, ClinicClock::minutes($window['end_time']), ClinicClock::minutes($hours['close']));
                if ($from >= $until) continue;
                $possible = array_map(fn (array $range) => [max($from, $range[0]), min($until, $range[1])], $coworkerWindows[$window['branch_ref']] ?? []);
                $gaps = StaffCoverageIntervals::gaps($from, $until, $possible);
                $missing = array_sum(array_map(fn (array $gap) => $gap[1] - $gap[0], $gaps));
                $status = $missing === 0 ? 'full_alternative' : ($missing === $until - $from ? 'no_alternative' : 'partial_alternative');
                match ($status) {
                    'full_alternative' => $matched++,
                    'partial_alternative' => $partial++,
                    default => $unmatched++,
                };
                $rows[] = ['date' => $date, 'branch_ref' => $branch->legacy_ref, 'branch_name' => $branch->name,
                    'from' => ClinicClock::time($from), 'until' => ClinicClock::time($until),
                    'alternative' => $status, 'unmatched_minutes' => $missing];
            }
        }
        return array_replace($base, ['assessment' => $base['truncated'] ? 'partial_preview' : ($rows ? 'review_ready' : 'unverified'),
            'reason' => $rows ? null : 'No overlapping published working hours could be verified for this leave period.',
            'window_count' => count($rows), 'fully_matched_windows' => $matched,
            'partially_matched_windows' => $partial, 'unmatched_windows' => $unmatched, 'windows' => $rows]);
    }
}
