<?php

namespace App\Http\Controllers\Reference;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reference\UpdateBranchRequest;
use App\Http\Resources\Reference\BranchResource;
use App\Http\Resources\Reference\BranchServiceResource;
use App\Models\Branch;
use App\Models\User;
use App\Services\Audit\AuditService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BranchController extends Controller
{
    // Explicit response()->json(['data' => ...]) rather than returning the Resource/Collection directly,
    // matching CurrentUserController's established convention — avoids JsonResource::toResponse()'s
    // auto-201-on-wasRecentlyCreated quirk and keeps every Phase 2A response shape consistent.
    public function index()
    {
        return response()->json(['data' => BranchResource::collection(Branch::orderBy('name')->get())]);
    }

    // {branch} resolves via Branch::getRouteKeyName() = 'legacy_ref' — see the Phase 2A plan, section C/D.
    public function update(UpdateBranchRequest $request, Branch $branch)
    {
        try {
            return DB::transaction(function () use ($request, $branch) {
                $actor = User::whereKey($request->user()->id)->lock('for no key update')->first();
                abort_unless($actor && $actor->role->value === 'owner' && $actor->account_status === 'Active'
                    && $actor->auth_version === $request->user()->auth_version, 403);
                $current = Branch::whereKey($branch->id)->lockForUpdate()->firstOrFail();
                $data = $request->validated();
                // Validate the effective pair, including PATCH requests that change only one endpoint.
                if (isset($data['open_time']) || isset($data['close_time'])) {
                    $open = substr($data['open_time'] ?? $current->open_time, 0, 5);
                    $close = substr($data['close_time'] ?? $current->close_time, 0, 5);
                    if ($close <= $open) {
                        throw ValidationException::withMessages(['close_time' => 'Closing time must be after opening time.']);
                    }
                }
                if (array_key_exists('weekly_hours', $data) && $data['weekly_hours'] !== null) {
                    $week = [];
                    foreach ($data['weekly_hours'] as $day => $hours) {
                        if (! in_array((string) $day, ['1', '2', '3', '4', '5', '6', '7'], true)) {
                            throw ValidationException::withMessages(['weekly_hours' => 'Use the weekdays 1 (Monday) to 7 (Sunday).']);
                        }
                        if ($hours['close'] <= $hours['open']) {
                            throw ValidationException::withMessages(["weekly_hours.{$day}.close" => 'Closing time must be after opening time.']);
                        }
                        $week[(string) $day] = ['open' => $hours['open'], 'close' => $hours['close']];
                    }
                    ksort($week);
                    // The older single fields stay consistent: open days, earliest opening and latest closing.
                    $data['weekly_hours'] = $week;
                    $data['operating_days'] = array_map('intval', array_keys($week));
                    $data['open_time'] = min(array_column($week, 'open'));
                    $data['close_time'] = max(array_column($week, 'close'));
                }
                elseif (array_key_exists('operating_days', $data) && ! array_key_exists('weekly_hours', $data) && is_array($current->weekly_hours) && $current->weekly_hours) {
                    // Only the open days changed: keep each remaining day's hours; a newly opened day gets the branch's usual hours.
                    $days = $data['operating_days'] ?: [1, 2, 3, 4, 5, 6, 7];
                    $week = [];
                    foreach ($days as $day) {
                        $week[(string) $day] = $current->weekly_hours[(string) $day] ?? ['open' => substr((string) ($data['open_time'] ?? $current->open_time), 0, 5), 'close' => substr((string) ($data['close_time'] ?? $current->close_time), 0, 5)];
                    }
                    ksort($week);
                    $data['weekly_hours'] = $week;
                }
                $current->fill($data);
                $changed = array_keys($current->getDirty());
                if ($changed) {
                    $current->save();
                    app(AuditService::class)->record([
                        'action' => 'branch.updated', 'category' => 'administrative',
                        'actor' => $actor, 'target' => $current,
                        'branch_id' => $current->id, 'payload' => ['fields' => $changed],
                    ]);
                }
                return response()->json(['data' => new BranchResource($current)]);
            });
        } catch (UniqueConstraintViolationException $exception) {
            // Different branch rows can pass request validation before either code
            // commits. Translate only this known collision after transaction rollback.
            if (! str_contains((string) ($exception->errorInfo[2] ?? ''), '"branches_branch_code_unique"')) {
                throw $exception;
            }
            throw ValidationException::withMessages([
                'branch_code' => 'This branch code is already in use. Choose another code.',
            ]);
        }
    }

    public function servicesForBranch(Branch $branch)
    {
        $rows = $branch->branchServices()->with(['branch', 'service'])->get();

        return response()->json(['data' => BranchServiceResource::collection($rows)]);
    }
}
