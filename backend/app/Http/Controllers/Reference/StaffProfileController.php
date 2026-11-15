<?php

namespace App\Http\Controllers\Reference;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reference\UpdateStaffProfileRequest;
use App\Http\Resources\Reference\StaffProfileResource;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Services\Scheduling\StaffShiftRevision;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StaffProfileController extends Controller
{
    // Route-gated to role:staff,dentist,owner — Patient is denied (Phase 2A plan, section H, point 1/7).
    public function index(Request $request)
    {
        $user = $request->user();
        $rows = StaffProfile::with(['person', 'branch'])
            ->when($user->role->value === 'staff', fn ($q) => $q->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id)))
            ->orderBy('id')->get();

        return response()->json(['data' => StaffProfileResource::collection($rows)]);
    }

    // {staffProfile} resolves via StaffProfile::getRouteKeyName() = 'legacy_ref'.
    public function update(UpdateStaffProfileRequest $request, StaffProfile $staffProfile)
    {
        return DB::transaction(function () use ($request, $staffProfile) {
            // Recheck authority after waiting; middleware authorization can precede a concurrent revocation.
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->role->value === 'owner' && $actor->account_status === 'Active'
                && $actor->auth_version === $request->user()->auth_version, 403);
            // Serialize this profile's assignments before locking the linked account used by scope replacement.
            $current = StaffProfile::whereKey($staffProfile->id)->lockForUpdate()->firstOrFail();
            $attributes = $request->safe()->except(['branch_ref', 'expected_revision', 'operation_id']);
            $operation = $request->validated('operation_id');
            if (! $operation) {
                return response()->json(['code' => 'staff_precondition_required',
                    'message' => 'Refresh and review the Staff profile before saving. An observed revision and operation ID are required.'], 409);
            }
            $command = $request->validated();
            ksort($command);
            $fingerprint = hash('sha256', json_encode($command, JSON_THROW_ON_ERROR));
            if ($operation) {
                $prior = AuditLog::where('action', 'staff_profile.updated')->where('auditable_type', 'StaffProfile')
                    ->where('auditable_public_id', $current->legacy_ref)->where('actor_user_id', $actor->id)
                    ->where('payload->operation_id', $operation)->first();
                if ($prior) {
                    if (($prior->payload['fingerprint'] ?? null) !== $fingerprint) {
                        return response()->json(['code' => 'staff_operation_conflict', 'message' => 'This operation was already used with different changes. Reload and review the profile.'], 409);
                    }
                    // This is the original committed receipt, even if the profile changed again afterwards.
                    return response()->json(['data' => $prior->payload['receipt'] + ['revision' => StaffShiftRevision::combine($prior->payload['state_digest'], $prior->id)],
                        'meta' => ['operation_id' => $operation, 'replayed' => true]]);
                }
                if (! hash_equals(StaffShiftRevision::for($current), $request->validated('expected_revision'))) {
                    return response()->json(['code' => 'staff_revision_conflict', 'message' => 'This Staff profile changed. Your draft is preserved. Refresh and review the current profile before saving again.'], 409);
                }
            }

            // Validate the complete resulting interval, including single-field PATCHes against stored hours.
            $start = substr((string) ($attributes['shift_start'] ?? $current->shift_start), 0, 5);
            $end = substr((string) ($attributes['shift_end'] ?? $current->shift_end), 0, 5);
            if ($start >= $end) {
                throw ValidationException::withMessages(['shift_end' => ['The shift end must be after its start.']]);
            }

            if ($request->has('branch_ref')) {
                $attributes['branch_id'] = $request->validated('branch_ref')
                    ? Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail()->id
                    : null;
            }

            $current->update($attributes);

            // Section 3.5: synchronize only explicit, persisted assignment changes. Repeating the current
            // branch must preserve independently authorized account scopes, including an empty scope set.
            // UserBranchScopeController uses the same account lock, serializing replacements even for empty sets.
            if ($request->has('branch_ref') && $current->wasChanged('branch_id') && $current->person_id) {
                $linkedUser = \App\Models\User::where('person_id', $current->person_id)
                    ->where('role', \App\Enums\Role::Staff)
                    ->lockForUpdate()->first();
                if ($linkedUser) {
                    // Preserved legacy behavior, NOT an approved policy: null assignment grants all Open branches.
                    $branchIds = $attributes['branch_id']
                        ? [$attributes['branch_id']]
                        : Branch::where('status', 'Open')->pluck('id')->all();
                    UserBranchScope::where('user_id', $linkedUser->id)->whereNotIn('branch_id', $branchIds ?: [0])->delete();
                    foreach ($branchIds as $branchId) {
                        UserBranchScope::firstOrCreate(['user_id' => $linkedUser->id, 'branch_id' => $branchId]);
                    }
                    app(AuditService::class)->recordAdministrative('account.branch_scopes_changed', $request->user(), $linkedUser, [
                        'branch_refs' => Branch::whereIn('id', UserBranchScope::select('branch_id')->where('user_id', $linkedUser->id))->pluck('legacy_ref')->all(),
                    ]);
                }
            }

            $current = $current->fresh(['person', 'branch']);
            $receipt = (new StaffProfileResource($current))->resolve($request);
            unset($receipt['revision']);
            $audit = app(AuditService::class)->record([
                'action' => 'staff_profile.updated', 'category' => 'administrative', 'actor' => $actor,
                'auditable_type' => 'StaffProfile', 'auditable_public_id' => $current->legacy_ref,
                'branch_id' => $current->branch_id,
                'payload' => ['operation_id' => $operation, 'fingerprint' => $fingerprint,
                    'receipt' => $receipt, 'state_digest' => StaffShiftRevision::stateDigest($current->getAttributes())],
            ]);

            return response()->json(['data' => $receipt + ['revision' => StaffShiftRevision::digest($current->getAttributes(), $audit->id)],
                'meta' => ['operation_id' => $operation, 'replayed' => false]]);
        });
    }
}
