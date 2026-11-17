<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Requests\Queue\QueuePriorityRequest;
use App\Http\Requests\Queue\QueueTransitionRequest;
use App\Http\Resources\QueueEntryResource;
use App\Models\QueueEntry;
use App\Services\Queue\QueueService;
use App\Services\Queue\QueueOrder;
use App\Support\ClinicClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

// M9 Queue API. Controllers only resolve references and authorize; every rule and state change lives in QueueService's
// named commands (no generic status PATCH). Queue entries are created only by M8 arrival.
class QueueController extends Controller
{
    use ReadsIdempotencyKey;

    public function __construct(private readonly QueueService $queue) {}

    public const LIST_LIMIT = 500;

    /** One clinic day's queue (default today), role-scoped; positions are computed by the server. */
    public function index(Request $request)
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d'],
            'branch_ref' => ['nullable', 'string'],
            'dentist_ref' => ['nullable', 'string'],
            'status' => ['nullable', 'string'],
        ]);
        $date = $validated['date'] ?? ClinicClock::today();
        $entries = QueueEntry::visibleTo($request->user())->with(QueueService::RELATIONS)
            ->whereHas('dentistQueue', function (Builder $q) use ($date, $validated) {
                $q->where('clinic_date', $date)
                    ->when($validated['branch_ref'] ?? null, fn ($b, $ref) => $b->whereHas('branch', fn ($x) => $x->where('legacy_ref', $ref)))
                    ->when($validated['dentist_ref'] ?? null, fn ($d, $ref) => $d->whereHas('dentist', fn ($x) => $x->where('legacy_ref', $ref)));
            })
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderBy(\App\Models\Visit::select('arrived_at')->whereColumn('visits.id', 'queue_entries.visit_id'))
            ->orderBy('visit_id')
            ->limit(self::LIST_LIMIT + 1)->get();
        // M9: the list is bounded, and it says so. One extra row is read only to know whether the day was cut off, so
        // a client never presents a cut-off list (or a zero) as complete.
        $truncated = $entries->count() > self::LIST_LIMIT;
        $entries = $entries->take(self::LIST_LIMIT)->values();
        $this->queue->withPositions($entries);

        return QueueEntryResource::collection($entries)
            ->additional(['meta' => ['limit' => self::LIST_LIMIT, 'returned' => $entries->count(), 'truncated' => $truncated]]);
    }

    public function show(QueueEntry $queueEntry): QueueEntryResource
    {
        Gate::authorize('view', $queueEntry);
        $entry = $queueEntry->load([...QueueService::RELATIONS, 'history']);
        $this->queue->withPositions([$entry]);

        return new QueueEntryResource($entry);
    }

    public function transition(QueueTransitionRequest $request, QueueEntry $queueEntry, string $command): JsonResponse
    {
        Gate::authorize($command === 'call' ? 'call' : 'operate', $queueEntry);

        return $this->queue->transition($request->user(), $queueEntry, $command, (int) $request->validated('expected_revision'), $this->idempotencyKey($request, true));
    }

    public function priority(QueuePriorityRequest $request, QueueEntry $queueEntry): JsonResponse
    {
        Gate::authorize('operate', $queueEntry);

        return $this->queue->priority(
            $request->user(),
            $queueEntry,
            $request->validated('priority'),
            $request->validated('reason'),
            (int) $request->validated('expected_revision'),
            $this->idempotencyKey($request, true),
            $request->validated('category'),
            $request->validated('verification_status'),
        );
    }

    /** F2: restore a late arrival's normal place (Staff override of R2-07, reason required, audited). */
    public function lateOrder(Request $request, QueueEntry $queueEntry): JsonResponse
    {
        Gate::authorize('operate', $queueEntry);
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:300'], 'expected_revision' => ['required', 'integer']]);

        return $this->queue->restoreOrder($request->user(), $queueEntry, trim($data['reason']), (int) $data['expected_revision'], $this->idempotencyKey($request, true));
    }

    public function order(Request $request, string $entryId): JsonResponse
    {
        $entry = QueueEntry::visibleTo($request->user())->where('public_id', $entryId)->firstOrFail();
        Gate::authorize('operate', $entry);
        $queue = $entry->dentistQueue;
        $snapshot = app(QueueOrder::class)->snapshot($queue->branch_id, $queue->clinic_date->format('Y-m-d'));
        abort_if($snapshot['rows']->count() > self::LIST_LIMIT, 409, 'Queue is too large to reorder safely.');
        $rows = new \Illuminate\Database\Eloquent\Collection($snapshot['rows']->all());
        $rows->load(QueueService::RELATIONS);
        $this->queue->withPositions($rows);

        return response()->json(['data' => ['revision' => $snapshot['revision'], 'entries' => QueueEntryResource::collection($rows)->resolve($request)]]);
    }

    public function reorder(Request $request, string $entryId): JsonResponse
    {
        $entry = QueueEntry::visibleTo($request->user())->where('public_id', $entryId)->firstOrFail();
        Gate::authorize('operate', $entry);
        $data = $request->validate([
            'before_entry_id' => ['present', 'nullable', 'string', 'size:26'],
            'order_revision' => ['required', 'string', 'size:64'],
            'expected_revision' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:3', 'max:300'],
        ]);
        $reason = trim($data['reason']);
        abort_if(mb_strlen($reason) < 3, 422, 'A reason is required.');

        return $this->queue->reorder($request->user(), $entry, $data['before_entry_id'], $reason,
            $data['order_revision'], (int) $data['expected_revision'], $this->idempotencyKey($request, true));
    }

    /** The authenticated Patient's own current queue state (identity from the session; no Patient id is accepted). */
    public function mine(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->role === Role::Patient && $user->patient !== null, 403, 'Forbidden.');

        return response()->json(['data' => $this->queue->patientCurrent($user->patient)]);
    }
}
