<?php

namespace App\Http\Controllers;

use App\Models\UserNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use App\Models\User;

/** The signed-in user's own notifications (identity-specific; never anyone else's). */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $input = $request->validate(['before' => ['sometimes', 'string', 'ulid'], 'collection' => ['sometimes', 'in:active,archived']]);
        $archival = Schema::hasTable('notification_archives');
        $collection = $input['collection'] ?? 'active';
        if ($collection === 'archived' && ! $archival) return $this->unavailable();
        $query = UserNotification::where('user_id', $user->id);
        if ($archival) {
            $query->with('archive');
            $collection === 'archived' ? $query->whereHas('archive') : $query->whereDoesntHave('archive');
        }
        if (isset($input['before'])) {
            // Resolve the cursor inside recipient scope; another account's cursor must not disclose history.
            $cursor = UserNotification::where('user_id', $user->id)->where('public_id', strtolower($input['before']))->firstOrFail();
            $query->where('id', '<', $cursor->id);
        }
        $page = $query->orderByDesc('id')->limit(51)->get();
        $rows = $page->take(50);

        return response()->json([
            'data' => $rows->map(fn (UserNotification $n) => [
                'id' => $n->public_id, 'kind' => $n->kind, 'title' => $n->title, 'body' => $n->body,
                'target' => $n->target_page ? ['page' => $n->target_page, 'id' => $n->target_id] : null,
                'created_at' => $n->created_at ? \App\Support\ClinicClock::local($n->created_at)->toIso8601String() : null, 'read' => $n->read_at !== null,
                'archived' => $archival && $n->archive !== null,
                'archived_at' => $archival && $n->archive ? ClinicClock::local($n->archive->archived_at)->toIso8601String() : null,
            ])->values(),
            'meta' => ['unread' => UserNotification::where('user_id', $user->id)->whereNull('read_at')->when($archival, fn ($q) => $q->whereDoesntHave('archive'))->count(),
                'collection' => $collection, 'archive_available' => $archival,
                'has_more' => $page->count() > 50, 'next_before' => $page->count() > 50 ? $rows->last()->public_id : null],
        ]);
    }

    public function read(Request $request, string $notification): JsonResponse
    {
        $updated = UserNotification::where('user_id', $request->user()->id)->where('public_id', strtolower($notification))->whereNull('read_at')->update(['read_at' => now()]);
        abort_if(! $updated && ! UserNotification::where('user_id', $request->user()->id)->where('public_id', strtolower($notification))->exists(), 404);

        // Preserve the list contract and confirm older read targets even when outside the first page.
        $response = $this->index($request);
        $body = $response->getData(true);
        $body['meta']['read_id'] = strtolower($notification);
        $response->setData($body);

        return $response;
    }

    public function readAll(Request $request): JsonResponse
    {
        UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')
            ->when(Schema::hasTable('notification_archives'), fn ($q) => $q->whereDoesntHave('archive'))->update(['read_at' => now()]);

        return $this->index($request);
    }

    public function archive(Request $request, string $notification): JsonResponse
    {
        if (! Schema::hasTable('notification_archives')) return $this->unavailable();

        return DB::transaction(function () use ($request, $notification) {
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->account_status === 'Active' && $actor->auth_version === $request->user()->auth_version, 403);
            $row = UserNotification::where('user_id', $actor->id)->where('public_id', strtolower($notification))->lockForUpdate()->firstOrFail();
            $archive = $row->archive;
            $replayed = $archive !== null;
            if (! $archive) {
                DB::table('notification_archives')->insert(['notification_id' => $row->id, 'archived_by_user_id' => $actor->id]);
                app(AuditService::class)->recordAdministrative('notification.archived', $actor, $row);
                $archive = $row->archive()->firstOrFail();
            }
            $response = $this->index($request);
            $body = $response->getData(true);
            $body['meta']['archive_receipt'] = ['id' => $row->public_id, 'archived' => true,
                'archived_at' => ClinicClock::local($archive->archived_at)->toIso8601String(), 'replayed' => $replayed];
            $response->setData($body);

            return $response;
        });
    }

    private function unavailable(): JsonResponse
    {
        return response()->json(['code' => 'notification_archive_unavailable', 'message' => 'Notification archival is not available on this server. Your notification was retained.'], 503);
    }
}
