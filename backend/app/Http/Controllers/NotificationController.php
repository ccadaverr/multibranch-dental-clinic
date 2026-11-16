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
            $query->with('archive');
            $collection === 'archived' ? $query->whereHas('archive') : $query->whereDoesntHave('archive');
        }

        return ['query' => $query, 'archival' => $archival, 'collection' => $collection];
    }

    private function historyResponse(Request $request, array $history, array $receipt = []): JsonResponse
    {
        ['query' => $query, 'archival' => $archival, 'collection' => $collection] = $history;
        $page = $query->orderByDesc('created_at')->orderByDesc('id')->limit(51)->get();
        $rows = $page->take(50);

        return response()->json([
            'data' => $rows->map(fn (UserNotification $n) => [
                'id' => $n->public_id, 'kind' => $n->kind, 'title' => $n->title, 'body' => $n->body,
                'target' => $n->target_page ? ['page' => $n->target_page, 'id' => $n->target_id] : null,
                'created_at' => $n->created_at ? ClinicClock::local($n->created_at)->toIso8601String() : null, 'read' => $n->read_at !== null,
                'archived' => $archival && $n->archive !== null,
                'archived_at' => $archival && $n->archive ? ClinicClock::local($n->archive->archived_at)->toIso8601String() : null,
            ])->values(),
            'meta' => ['unread' => UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')->when($archival, fn ($q) => $q->whereDoesntHave('archive'))->count(),
                'collection' => $collection, 'archive_available' => $archival,
                'has_more' => $page->count() > 50, 'next_before' => $page->count() > 50 ? $rows->last()->public_id : null] + $receipt,
        ]);
    }

    public function read(Request $request, string $notification): JsonResponse
    {
        $history = $this->prepareHistory($request, Schema::hasTable('notification_archives'));
        $id = strtolower($notification);

        return DB::transaction(function () use ($request, $id, $history) {
            $target = UserNotification::where('user_id', $request->user()->id)->where('public_id', $id);
            $updated = (clone $target)->whereNull('read_at')->update(['read_at' => now()]);
            abort_if(! $updated && ! $target->exists(), 404);

            return $this->historyResponse($request, $history, ['read_id' => $id]);
        });
    }

    public function readAll(Request $request): JsonResponse
    {
        $archival = Schema::hasTable('notification_archives');
        $history = $this->prepareHistory($request, $archival);

        return DB::transaction(function () use ($request, $history, $archival) {
            UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')
                ->when($archival, fn ($q) => $q->whereDoesntHave('archive'))->update(['read_at' => now()]);

            return $this->historyResponse($request, $history);
        });
    }

    public function archive(Request $request, string $notification): JsonResponse
    {
        if (! Schema::hasTable('notification_archives')) return $this->unavailable();

        return DB::transaction(function () use ($request, $notification) {
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->account_status === 'Active' && $actor->auth_version === $request->user()->auth_version, 403);
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

    private function unavailable(): JsonResponse
    {
        return response()->json(['code' => 'notification_archive_unavailable', 'message' => 'Notification archival is not available on this server. Your notification was retained.'], 503);
    }
}
