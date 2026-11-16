<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Support\ClinicClock;
use Illuminate\Contracts\Database\Eloquent\Builder as BuilderContract;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

// M22 audit history API — read-only. There is no create, update or delete endpoint: rows are written only by AuditService.
// Owner only (existing contract; the role middleware on the route and the check below both enforce it); every other role is
// refused. Filters are validated and allowlisted, pagination is bounded and cursor-based, and ordering is deterministic.
class AuditController extends Controller
{
    private const MAX_PER_PAGE = 100;

    private const EXPORT_LIMIT = 5000;

    private function authorizeOwner(Request $request): void
    {
        abort_unless($request->user() && $request->user()->role === Role::Owner, 403, 'Audit trail inspection is restricted to the clinic Owner.');
    }

    /** @return array<string, mixed> */
    private function validatedFilters(Request $request, bool $paged): array
    {
        $rules = [
            'search' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', 'string', 'in:all,'.implode(',', AuditLog::CATEGORIES)],
            'severity' => ['nullable', 'string', 'in:all,'.implode(',', AuditLog::SEVERITIES)],
            'branch_id' => ['nullable', 'string', 'max:64'],
            'action' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9_.]+$/'],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d'],
        ];
        $rules += [
            'target_type' => ['nullable', 'required_with:target_id', 'string', 'max:100'],
            'target_id' => ['nullable', 'required_with:target_type', 'string', 'max:50'],
        ];
        if ($paged) {
            $rules += ['per_page' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE], 'cursor' => ['nullable', 'string', 'size:26']];
        }
        $v = $request->validate($rules);
        if (! empty($v['date_from']) && ! empty($v['date_to']) && $v['date_from'] > $v['date_to']) {
            throw ValidationException::withMessages(['date_to' => 'The end date must not be before the start date.']);
        }
        if (! empty($v['branch_id']) && ! Branch::where('legacy_ref', $v['branch_id'])->orWhereRaw('lower(public_id) = ?', [strtolower($v['branch_id'])])->exists()) {
            throw ValidationException::withMessages(['branch_id' => 'Choose an existing branch.']);
        }

        return $v;
    }

    private function filtered(array $v): BuilderContract
    {
        $query = AuditLog::query()->with(['actor.person', 'branch'])
            ->search($v['search'] ?? null)
            ->byCategory($v['category'] ?? null)
            ->bySeverity($v['severity'] ?? null)
            ->forBranch($v['branch_id'] ?? null);

        if (! empty($v['action'])) {
            $query->where('action', $v['action']);
        }
        if (isset($v['target_type'], $v['target_id'])) {
            $query->where('auditable_type', $v['target_type'])
                ->where('auditable_public_id', $v['target_id']);
        }

        // Dates are clinic (Asia/Manila) business days; the stored instants are timestamptz.
        if (! empty($v['date_from'])) {
            $query->where('created_at', '>=', ClinicClock::at($v['date_from'], '00:00')->startOfDay()->toIso8601String());
        }
        if (! empty($v['date_to'])) {
            $query->where('created_at', '<', ClinicClock::at($v['date_to'], '00:00')->addDay()->startOfDay()->toIso8601String());
        }

        return $query->orderByDesc('created_at')->orderByDesc('id');
    }

    public function index(Request $request): JsonResponse
    {
        $this->authorizeOwner($request);
        $v = $this->validatedFilters($request, true);
        $perPage = (int) ($v['per_page'] ?? 50);

        $query = $this->filtered($v);
        if (! empty($v['cursor'])) {
            // Resolve the public cursor inside the active filters. The stored timestamp carries its database offset.
            $anchor = (clone $query)->toBase()->reorder()
                ->where('public_id', strtolower($v['cursor']))->first(['created_at', 'id']);
            if ($anchor) {
                $query->whereRaw('(created_at, id) < (?, ?)', [$anchor->created_at, $anchor->id]);
            } else {
                $query->whereRaw('false');
            }
        }

        $rows = $query->limit($perPage + 1)->get();
        $more = $rows->count() > $perPage;
        $page = $rows->take($perPage)->values();

        return response()->json([
            'data' => AuditLogResource::collection($page),
            'meta' => ['per_page' => $perPage, 'next_cursor' => $more ? $page->last()->public_id : null],
        ]);
    }

    public function show(Request $request, AuditLog $auditLog): JsonResponse
    {
        $this->authorizeOwner($request);

        return response()->json(['data' => new AuditLogResource($auditLog->load(['actor.person', 'branch']))]);
    }

    public function export(Request $request): StreamedResponse
    {
        $this->authorizeOwner($request);
        $v = $this->validatedFilters($request, false);

        // One extra row tells us honestly whether the export was cut at the bound.
        $rows = $this->filtered($v)->limit(self::EXPORT_LIMIT + 1)->get();
        $truncated = $rows->count() > self::EXPORT_LIMIT;
        $logs = $rows->take(self::EXPORT_LIMIT);
        $filename = 'audit_trail_'.ClinicClock::now()->format('Ymd_His').'.csv';

        return response()->stream(function () use ($logs) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['ID', 'Timestamp', 'Action', 'Category', 'Severity', 'Actor Name', 'Actor Role', 'Branch', 'Target Type', 'Target ID', 'IP Address', 'Details']);
            foreach ($logs as $log) {
                $payloadText = json_encode($log->payload ?? [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                fputcsv($handle, array_map($this->sanitizeCsvCell(...), [
                    $log->public_id, ClinicClock::local($log->created_at)->toIso8601String(), $log->action, $log->category, $log->severity,
                    $log->actor_name ?? '', $log->actor_role ?? '', $log->branch?->name ?? 'No branch recorded', $log->auditable_type ?? '',
                    $log->auditable_public_id ?? '', $log->ip_address ?? '', $payloadText,
                ]));
            }
            fclose($handle);
        }, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
            'X-Audit-Export-Limit' => (string) self::EXPORT_LIMIT,
            'X-Audit-Export-Truncated' => $truncated ? 'true' : 'false',
        ]);
    }

    /** Prevents CSV formula injection (=, +, -, @, tab, CR). */
    private function sanitizeCsvCell(string $value): string
    {
        return preg_match('/^[=+\-@\t\r]/', $value) ? "'".$value : $value;
    }
}
