<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Requests\User\SetBranchScopesRequest;
use App\Models\Branch;
use App\Models\User;
use App\Models\UserBranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

// M1 administration of AUTHORIZATION branch scopes (user_branch_scopes), Owner-only via the `role:owner` route
// middleware — so a Staff account can never grant itself access. Scopes apply to Staff accounts only: Owner
// authority is global by policy, Patient ownership comes from the Patient relationship and Dentist access from the
// Dentist profile. Operational work assignment (staff_profiles.branch_id, dentist_branches) is never read or
// written here.
class UserBranchScopeController extends Controller
{
    public function show(User $user): JsonResponse
    {
        return $this->scopes($user);
    }

    public function update(SetBranchScopesRequest $request, User $user): JsonResponse
    {
        $branchIds = Branch::whereIn('legacy_ref', $request->validated('branch_refs'))->pluck('id')->all();

        return DB::transaction(function () use ($request, $user, $branchIds) {
            // Keep the current Owner authority stable while waiting for the target account.
            // Middleware and route-bound models may predate concurrent account revocation.
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->role === Role::Owner && $actor->account_status === 'Active'
                && $actor->auth_version === $request->user()->auth_version, 403);
            $current = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            if ($current->role !== Role::Staff) {
                throw ValidationException::withMessages(['user' => 'Branch authorization scopes apply to Staff accounts only.']);
            }
            UserBranchScope::where('user_id', $user->id)->whereNotIn('branch_id', $branchIds ?: [0])->delete();
            foreach ($branchIds as $branchId) {
                UserBranchScope::firstOrCreate(['user_id' => $user->id, 'branch_id' => $branchId]);
            }
            app(\App\Services\Audit\AuditService::class)->recordAdministrative('account.branch_scopes_changed', $actor, $current, ['branch_refs' => Branch::whereIn('id', $branchIds)->pluck('legacy_ref')->all()]);
            return $this->scopes($current);
        });
    }

    private function scopes(User $user): JsonResponse
    {
        return response()->json(['data' => [
            'user' => ['id' => $user->public_id, 'role' => $user->role->value],
            'branch_scopes' => $user->branchScopes()->with('branch')->orderBy('branch_id')->get()
                ->map(fn (UserBranchScope $scope) => ['id' => $scope->branch->legacy_ref, 'name' => $scope->branch->name])->values(),
        ]]);
    }
}
