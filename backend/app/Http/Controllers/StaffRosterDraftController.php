<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\StaffProfile;
use App\Models\StaffRosterDraft;
use App\Models\User;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Owner preparation records, never published work or a source for clinical booking/duty. */
class StaffRosterDraftController extends Controller
{
    private function authorizeOwner(Request $request): void
    {
        abort_unless($request->user()?->role->value === 'owner', 403);
    }

    private function ready(): bool { return Schema::hasTable('staff_roster_drafts') && Schema::hasTable('staff_roster_draft_revisions'); }

    private function unavailable(): JsonResponse
    {
        return response()->json(['code' => 'staff_roster_drafts_unavailable', 'message' => 'Dated Staff draft preparation is unavailable on this server. No duty was changed.'], 503);
    }

    public function show(Request $request, StaffProfile $staffProfile): JsonResponse
    {
        $this->authorizeOwner($request);
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d']]);
        if (! $this->ready()) return $this->unavailable();
        $draft = StaffRosterDraft::with('branch')->where('staff_profile_id', $staffProfile->id)->where('on_date', $data['date'])->first();

        return response()->json(['data' => $draft ? $this->view($draft, $staffProfile) : null,
            'meta' => ['staff_ref' => $staffProfile->legacy_ref, 'date' => $data['date'], 'revision' => $draft?->revision ?? 0, 'publication_available' => false]]);
    }

    public function save(Request $request, StaffProfile $staffProfile): JsonResponse
    {
        $this->authorizeOwner($request);
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'branch_ref' => ['required', 'string', 'max:50'],
            'start_time' => ['required', 'date_format:H:i'], 'end_time' => ['required', 'date_format:H:i', 'after:start_time'],
            'expected_revision' => ['required', 'integer', 'min:0'], 'operation_id' => ['required', 'uuid', 'lowercase'],
            'id' => ['prohibited'], 'staff_ref' => ['prohibited'], 'revision' => ['prohibited'], 'status' => ['prohibited'], 'published' => ['prohibited'],
            'weekdays' => ['prohibited'], 'effective_from' => ['prohibited'], 'effective_until' => ['prohibited']]);
        if (! $this->ready()) return $this->unavailable();

        return DB::transaction(function () use ($request, $staffProfile, $data) {
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->role->value === 'owner' && $actor->account_status === 'Active' && $actor->auth_version === $request->user()->auth_version, 403);
            $staff = StaffProfile::whereKey($staffProfile->id)->lockForUpdate()->firstOrFail();
            $command = $data + ['staff_ref' => $staff->legacy_ref]; ksort($command);
            $fingerprint = hash('sha256', json_encode($command, JSON_THROW_ON_ERROR));
            $prior = AuditLog::where('action', 'staff_roster.draft_saved')->where('actor_user_id', $actor->id)->where('payload->operation_id', $data['operation_id'])->first();
            if ($prior) {
                if ($prior->payload['fingerprint'] !== $fingerprint) return $this->conflict('staff_roster_operation_conflict', 'This operation already saved a different draft. Review the current Staff and date.');
                return response()->json(['data' => $prior->payload['receipt'], 'meta' => ['operation_id' => $data['operation_id'], 'replayed' => true, 'publication_available' => false]]);
            }
            $draft = StaffRosterDraft::where('staff_profile_id', $staff->id)->where('on_date', $data['date'])->lockForUpdate()->first();
            if ((int) $data['expected_revision'] !== ($draft?->revision ?? 0)) return $this->conflict('staff_roster_revision_conflict', 'This dated draft changed. Your entries are preserved. Reload and review before another save.');
            $branch = Branch::where('legacy_ref', $data['branch_ref'])->lockForUpdate()->first();
            if (! $branch || $branch->status !== 'Open') throw ValidationException::withMessages(['branch_ref' => ['Choose an existing open branch.']]);
            $hours = $branch->hoursOnDate($data['date']);
            if (! $hours || $data['start_time'] < $hours['open'] || $data['end_time'] > $hours['close']) throw ValidationException::withMessages(['start_time' => ['Draft hours must fit the branch operating calendar on the selected date.']]);
            $values = ['branch_id' => $branch->id, 'start_time' => $data['start_time'], 'end_time' => $data['end_time'], 'revision' => ($draft?->revision ?? 0) + 1,
                'status' => 'Draft', 'updated_by_user_id' => $actor->id];
            if ($draft) $draft->update($values);
            else $draft = StaffRosterDraft::create($values + ['staff_profile_id' => $staff->id, 'on_date' => $data['date']]);
            $receipt = $this->view($draft->fresh('branch'), $staff);
            DB::table('staff_roster_draft_revisions')->insert(['public_id' => strtolower((string) Str::ulid()), 'draft_id' => $draft->id,
                'revision' => $draft->revision, 'actor_user_id' => $actor->id, 'snapshot' => json_encode($receipt, JSON_THROW_ON_ERROR)]);
            app(AuditService::class)->record(['action' => 'staff_roster.draft_saved', 'category' => 'administrative', 'actor' => $actor,
                'target' => $draft, 'branch_id' => $branch->id, 'payload' => ['operation_id' => $data['operation_id'], 'fingerprint' => $fingerprint, 'receipt' => $receipt]]);

            return response()->json(['data' => $receipt, 'meta' => ['operation_id' => $data['operation_id'], 'replayed' => false, 'publication_available' => false]]);
        });
    }

    public function history(Request $request, StaffProfile $staffProfile): JsonResponse
    {
        $this->authorizeOwner($request);
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'before' => ['sometimes', 'ulid']]);
        if (! $this->ready()) return $this->unavailable();
        $draft = StaffRosterDraft::where('staff_profile_id', $staffProfile->id)->where('on_date', $data['date'])->first();
        $query = DB::table('staff_roster_draft_revisions')->where('draft_id', $draft?->id ?? 0);
        if (isset($data['before'])) {
            $anchor = DB::table('staff_roster_draft_revisions')->where('draft_id', $draft?->id ?? 0)->where('public_id', strtolower($data['before']))->first();
            abort_unless($anchor, 404);
            $query->where('id', '<', $anchor->id);
        }
        $rows = $query->orderByDesc('id')->limit(51)->get(); $page = $rows->take(50);

        return response()->json(['data' => $page->map(fn ($row) => ['id' => $row->public_id, 'revision' => $row->revision,
            'saved_at' => ClinicClock::local(\Carbon\CarbonImmutable::parse($row->created_at))->toIso8601String(), 'draft' => json_decode($row->snapshot, true)])->values(),
            'meta' => ['staff_ref' => $staffProfile->legacy_ref, 'date' => $data['date'], 'next_before' => $rows->count() > 50 ? $page->last()->public_id : null, 'publication_available' => false]]);
    }

    private function view(StaffRosterDraft $draft, StaffProfile $staff): array
    {
        return ['id' => $draft->public_id, 'staff_ref' => $staff->legacy_ref, 'branch_ref' => $draft->branch->legacy_ref, 'branch_name' => $draft->branch->name,
            'date' => $draft->on_date->toDateString(), 'start_time' => substr($draft->start_time, 0, 5), 'end_time' => substr($draft->end_time, 0, 5),
            'revision' => $draft->revision, 'status' => 'Draft', 'published' => false];
    }

    private function conflict(string $code, string $message): JsonResponse { return response()->json(compact('code', 'message'), 409); }
}
