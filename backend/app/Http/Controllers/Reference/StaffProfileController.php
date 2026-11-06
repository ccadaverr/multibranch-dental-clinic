<?php

namespace App\Http\Controllers\Reference;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reference\UpdateStaffProfileRequest;
use App\Http\Resources\Reference\StaffProfileResource;
use App\Models\Branch;
use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
            // Serialize this profile's assignments before locking the linked account used by scope replacement.
            $current = StaffProfile::whereKey($staffProfile->id)->lockForUpdate()->firstOrFail();
            $attributes = $request->safe()->except('branch_ref');

            if ($request->has('branch_ref')) {
                $attributes['branch_id'] = $request->validated('branch_ref')
                    ? Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail()->id
                    : null;
            }

            $current->update($attributes);

            // Section 3.5: synchronize only explicit assignment changes. The account lock is also used by
            // UserBranchScopeController, so replacements share a serialization point, including empty scope sets.
            if ($request->has('branch_ref') && $current->person_id) {
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

            return response()->json(['data' => new StaffProfileResource($current->fresh(['person', 'branch']))]);
        });
    }
}
