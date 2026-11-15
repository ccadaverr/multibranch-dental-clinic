<?php

namespace App\Http\Controllers;

use App\Models\UserNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The signed-in user's own notifications (identity-specific; never anyone else's). */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $input = $request->validate(['before' => ['sometimes', 'string', 'ulid']]);
        $query = UserNotification::where('user_id', $user->id);
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
            ])->values(),
            'meta' => ['unread' => UserNotification::where('user_id', $user->id)->whereNull('read_at')->count(),
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
        UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')->update(['read_at' => now()]);

        return $this->index($request);
    }
}
