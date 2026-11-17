<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserNotification;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** The signed-in user's own notifications (identity-specific; never anyone else's). */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $history = $this->prepareHistory($request, Schema::hasTable('notification_archives'));

        return $this->historyResponse($request, $history);
    }

    /** @return array{query: Builder<UserNotification>, archival: bool, collection: string} */
    private function prepareHistory(Request $request, bool $archival): array
    {
        $input = $request->validate(['before' => ['sometimes', 'string', 'ulid'], 'collection' => ['sometimes', 'in:active,archived']]);
        $collection = $input['collection'] ?? 'active';
        if ($collection === 'archived' && ! $archival) {
            throw new HttpResponseException($this->unavailable());
        }

        $query = UserNotification::where('user_id', $request->user()->id);
        if (isset($input['before'])) {
            // Resolve inside recipient scope before applying the collection. A cursor survives archiving its anchor.
            $cursor = (clone $query)->where('public_id', strtolower($input['before']))
                ->toBase()->first(['created_at', 'id']);
            abort_if(! $cursor, 404);
            $query->whereRaw('(created_at, id) < (?, ?)', [$cursor->created_at, $cursor->id]);
        }
        if ($archival) {
            $collection === 'archived' ? $query->whereHas('archive') : $query->whereDoesntHave('archive');
        }

        return ['query' => $query, 'archival' => $archival, 'collection' => $collection];
    }

    private function historyResponse(Request $request, array $history, array $receipt = []): JsonResponse
    {
        ['query' => $query, 'archival' => $archival, 'collection' => $collection] = $history;
        $query->select(['id', 'public_id', 'kind', 'title', 'body', 'target_page', 'target_id', 'created_at', 'read_at']);
        if ($archival) {
            $query->withAggregate('archive as archive_recorded_at', 'archived_at');
        }
        $query->orderByDesc('created_at')->orderByDesc('id')->limit(51);
        $unread = UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')
            ->when($archival, fn ($query) => $query->whereDoesntHave('archive'))
            ->selectRaw('count(*) as active_unread_count');

        // One PostgreSQL statement keeps the page, archive evidence and count on the same snapshot.
        // Start with the count so even an empty continuation returns the correct unread total.
        $result = UserNotification::query()
            ->fromSub($unread->toBase(), 'totals')
            ->leftJoinLateral($query->toBase(), 'page')
            ->select('page.*', 'totals.active_unread_count')
            ->orderByDesc('page.created_at')->orderByDesc('page.id')
            ->withCasts(['archive_recorded_at' => 'immutable_datetime'])
            ->get();
        $page = $result->filter(fn (UserNotification $notification) => $notification->getKey() !== null);
        $rows = $page->take(50);

        return response()->json([
            'data' => $rows->map(fn (UserNotification $n) => [
                'id' => $n->public_id, 'kind' => $n->kind, 'title' => $n->title, 'body' => $n->body,
                'target' => $n->target_page ? ['page' => $n->target_page, 'id' => $n->target_id] : null,
                'created_at' => $n->created_at ? ClinicClock::local($n->created_at)->toIso8601String() : null, 'read' => $n->read_at !== null,
                'archived' => $archival && $n->archive_recorded_at !== null,
                'archived_at' => $archival && $n->archive_recorded_at ? ClinicClock::local($n->archive_recorded_at)->toIso8601String() : null,
            ])->values(),
            'meta' => ['unread' => (int) $result->first()->active_unread_count,
                'collection' => $collection, 'archive_available' => $archival,
                'has_more' => $page->count() > 50, 'next_before' => $page->count() > 50 ? $rows->last()->public_id : null] + $receipt,
        ]);
    }

    public function read(Request $request, string $notification): JsonResponse
    {
        $id = strtolower($notification);

        return DB::transaction(function () use ($request, $id) {
            $actor = $this->lockCurrentActor($request);
            $history = $this->prepareHistory($request, Schema::hasTable('notification_archives'));
            $target = UserNotification::where('user_id', $actor->id)->where('public_id', $id);
            $updated = (clone $target)->whereNull('read_at')->update(['read_at' => now()]);
            abort_if(! $updated && ! $target->exists(), 404);

            return $this->historyResponse($request, $history, ['read_id' => $id]);
        });
    }

    public function readAll(Request $request): JsonResponse
    {
        return DB::transaction(function () use ($request) {
            $actor = $this->lockCurrentActor($request);
            $archival = Schema::hasTable('notification_archives');
            $history = $this->prepareHistory($request, $archival);
            UserNotification::where('user_id', $actor->id)->whereNull('read_at')
                ->when($archival, fn ($q) => $q->whereDoesntHave('archive'))->update(['read_at' => now()]);

            return $this->historyResponse($request, $history);
        });
    }

    public function archive(Request $request, string $notification): JsonResponse
    {
        if (! Schema::hasTable('notification_archives')) return $this->unavailable();

        return DB::transaction(function () use ($request, $notification) {
            $actor = $this->lockCurrentActor($request);
            $history = $this->prepareHistory($request, true);
            $row = UserNotification::where('user_id', $actor->id)->where('public_id', strtolower($notification))->lockForUpdate()->firstOrFail();
            $archive = $row->archive;
            $replayed = $archive !== null;
            if (! $archive) {
                DB::table('notification_archives')->insert(['notification_id' => $row->id, 'archived_by_user_id' => $actor->id]);
                app(AuditService::class)->recordAdministrative('notification.archived', $actor, $row);
                $archive = $row->archive()->firstOrFail();
            }
            return $this->historyResponse($request, $history, ['archive_receipt' => [
                'id' => $row->public_id, 'archived' => true,
                'archived_at' => ClinicClock::local($archive->archived_at)->toIso8601String(), 'replayed' => $replayed,
            ]]);
        });
    }

    private function lockCurrentActor(Request $request): User
    {
        $original = $request->user();
        $actor = User::whereKey($original->id)->lockForUpdate()->first();
        abort_unless($actor && $actor->account_status === 'Active' &&
            $actor->auth_version === $original->auth_version && $actor->role === $original->role, 403);

        return $actor;
    }

    private function unavailable(): JsonResponse
    {
        return response()->json(['code' => 'notification_archive_unavailable', 'message' => 'Notification archival is not available on this server. Your notification was retained.'], 503);
    }
}
