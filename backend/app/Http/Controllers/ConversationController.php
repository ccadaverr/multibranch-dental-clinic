<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Requests\Messaging\CloseConversationRequest;
use App\Http\Requests\Messaging\SendMessageRequest;
use App\Http\Requests\Messaging\StartConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Branch;
use App\Models\Conversation;
use App\Models\ConversationMessage;
use App\Services\Messaging\MessagingService;
use App\Services\Messaging\Presence;
use App\Services\Messaging\MessageSearch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// M17 API (route middleware role:patient,staff,dentist; Owner and guests have none). Authorization is Conversation::visibleTo applied
// BEFORE any cursor or filter. A Patient may start a front-desk conversation (decision 3); Staff may add a Dentist. There is no
// edit-message or delete-message route, and Staff cannot start conversations (no approved rule for it).
class ConversationController extends Controller
{
    use ReadsIdempotencyKey;

    private const MAX_PER_PAGE = 100;

    public function __construct(private readonly MessagingService $messaging) {}

    /** Branches a Patient can write to, and the suggested one: the branch of their latest visit or appointment, else their preferred branch. */
    public function startOptions(Request $request): JsonResponse
    {
        $patient = $request->user()->patient;
        abort_unless($patient, 403);
        Presence::touch($request->user());
        $branches = Branch::where('status', 'Open')->orderBy('name')->get();
        // Decision 6: no required branch step. The front desk is chosen in this order: the branch of the next upcoming
        // appointment, else of the latest visit, else the Patient's preferred branch, else the first branch. The Patient can change it.
        $upcoming = DB::table('appointments')->where('patient_id', $patient->id)->whereIn('status', ['Confirmed', 'Pending'])
            ->where('starts_at', '>=', now()->toIso8601String())->orderBy('starts_at')->value('branch_id');
        $latestVisit = DB::table('visits')->where('patient_id', $patient->id)->orderByDesc('arrived_at')->value('branch_id');
        [$defaultId, $reason] = match (true) {
            $upcoming !== null && $branches->contains('id', $upcoming) => [$upcoming, 'upcoming_appointment'],
            $latestVisit !== null && $branches->contains('id', $latestVisit) => [$latestVisit, 'latest_visit'],
            $patient->preferred_branch_id !== null && $branches->contains('id', $patient->preferred_branch_id) => [$patient->preferred_branch_id, 'preferred_branch'],
            default => [$branches->sortBy('id')->first()?->id, 'first_branch'],
        };
        $default = $branches->firstWhere('id', $defaultId);

        return response()->json(['data' => [
            'branches' => $branches->map(fn (Branch $b) => ['id' => strtolower($b->public_id), 'name' => $b->name, 'address' => $b->address])->values(),
            'default_branch_id' => $default ? strtolower($default->public_id) : null,
            'default_reason' => $default ? $reason : null,
        ]]);
    }

    /** A Patient writes to a branch front desk. Their open conversation at that branch is reused; otherwise a new one starts. */
    public function start(StartConversationRequest $request): JsonResponse
    {
        $branch = Branch::whereRaw('lower(public_id) = ?', [strtolower($request->validated('branch_id'))])->where('status', 'Open')->first();
        if (! $branch) throw \Illuminate\Validation\ValidationException::withMessages(['branch_id' => 'Choose one of the clinic’s branches.']);
        Presence::touch($request->user());

        return $this->messaging->start($request->user(), $branch, $request->validated('body'), $this->idempotencyKey($request, true));
    }

    /** Heartbeat from a visible signed-in tab: the person is in the app, so no email alert is needed. */
    public function presence(Request $request): JsonResponse
    {
        Presence::touch($request->user());

        return response()->json(['data' => ['online' => true]]);
    }

    public function dentistOptions(Request $request, Conversation $conversation): JsonResponse
    {
        abort_unless($request->user()->role === \App\Enums\Role::Staff && $conversation->accessibleTo($request->user()), 403);

        if (! app(\App\Services\Messaging\ConversationDentistAccess::class)->available()) throw new \App\Services\Visits\VisitCommandException(409, 'conversation_grants_unavailable', 'Dentist reassignment is unavailable. No access was changed. Contact the clinic administrator.');

        return response()->json(['data' => $this->messaging->dentistOptions($conversation),
            'meta' => ['grant_required' => app(\App\Services\Messaging\ConversationDentistAccess::class)->enforced(), 'revision' => $conversation->revision,
                'context' => ['conversation_id' => $conversation->public_id, 'patient_id' => $conversation->patient->public_id, 'branch_id' => $conversation->branch->legacy_ref]]])->header('Cache-Control', 'private, no-store');
    }

    public function addParticipant(Request $request, Conversation $conversation): JsonResponse
    {
        abort_unless($request->user()->role === \App\Enums\Role::Staff && $conversation->accessibleTo($request->user()), 403);
        $access = app(\App\Services\Messaging\ConversationDentistAccess::class);
        if (! $access->available()) throw new \App\Services\Visits\VisitCommandException(409, 'conversation_grants_unavailable', 'Dentist reassignment is unavailable. No access was changed. Contact the clinic administrator.');
        $v = $request->validate(['dentist_id' => ['required', 'string', 'size:26'], 'expected_revision' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:500'], ...array_fill_keys(['user_id', 'role', 'patient_id', 'branch_id'], ['prohibited'])]);
        return $access->reassign($request->user(), $conversation, $v['dentist_id'], $v['expected_revision'], $v['reason'], $this->idempotencyKey($request, true));
    }

    /** The viewer's conversations, newest-created first (keyset by id), with an unread count and no message text. */
    public function index(Request $request): JsonResponse
    {
        Presence::touch($request->user());
        $v = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE], 'cursor' => ['nullable', 'string', 'size:26'], 'status' => ['nullable', 'string', 'in:Open,Closed'], 'q' => ['nullable', 'string', 'max:120']]);
        $per = (int) ($v['per_page'] ?? 50);
        $user = $request->user();
        $query = $this->summaries($user)->visibleTo($user);
        if (! empty($v['status'])) {
            $query->where('status', $v['status']);
        }
        $term = trim((string) ($v['q'] ?? ''));
        if (! empty($v['cursor'])) {
            $query->where('id', '<', Conversation::visibleTo($user)->select('id')->where('public_id', strtolower($v['cursor']))->limit(1));
        }
        if ($term !== '') {
            $this->limitSearch($request);
            $bodyMatches = MessageSearch::conversationIds($query, $term);
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($term, 'UTF-8')).'%';
            $query->where(function ($sub) use ($like, $bodyMatches, $user) {
                $sub->whereRaw('LOWER(conversations.context) LIKE ?', [$like])
                    ->orWhereIn('conversations.id', $bodyMatches)
                    ->orWhereHas('participants', function ($participants) use ($like, $user) {
                        if ($user->role === \App\Enums\Role::Patient) {
                            $participants->where(fn ($p) => $p->whereColumn('user_id', 'conversations.assigned_user_id')
                                ->orWhereHas('user', fn ($u) => $u->where('role', 'dentist')));
                        }
                        $participants->whereHas('user.person', fn ($person) => $person->whereRaw("LOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ?", [$like]));
                    })
                    ->orWhereHas('patient', fn ($pq) => $pq->whereRaw('LOWER(patient_code) LIKE ?', [$like])
                        ->orWhereHas('person', fn ($perQ) => $perQ->whereRaw("LOWER( COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') ) LIKE ?", [$like])))
                    ->orWhereHas('branch', fn ($bq) => $bq->whereRaw('LOWER(name) LIKE ?', [$like]));
            });
        }
        $rows = $query->with(['patient.person', 'branch', 'participants.user.person', 'assignee.person'])->orderByDesc('id')->limit($per + 1)->get();
        $page = $rows->take($per)->values();

        return response()->json(['data' => ConversationResource::collection($page)->resolve($request), 'meta' => ['per_page' => $per, 'next_cursor' => $rows->count() > $per ? $page->last()->public_id : null, 'channels' => $this->inboxChannels($user)]])->header('Cache-Control', 'private, no-store');
    }

    /** Realtime inbox channels this account may subscribe to (the same rules as routes/channels.php): branch inboxes for Staff, own channel otherwise. */
    private function inboxChannels($user): array
    {
        if ($user->role === \App\Enums\Role::Staff) {
            return Branch::whereIn('id', \App\Models\UserBranchScope::where('user_id', $user->id)->select('branch_id'))->pluck('public_id')
                ->map(fn ($id) => 'branch-inbox.'.strtolower($id))->values()->all();
        }

        return ['user.'.strtolower((string) $user->public_id)];
    }

    /** Authoritative in-application counts for the viewer (a genuine zero is a zero; the client must treat a failure as unavailable). */
    public function summary(Request $request): JsonResponse
    {
        $rows = $this->summaries($request->user())->visibleTo($request->user())->get(['conversations.id', 'conversations.status']);

        return response()->json(['data' => ['conversations' => $rows->count(), 'open' => $rows->where('status', 'Open')->count(), 'unread_conversations' => $rows->filter(fn ($c) => (int) $c->unread_count > 0)->count()]]);
    }

    private function readableConversation(Request $request, string $id): Conversation
    {
        abort_if($request->user()->role->value === 'owner', 403);
        $conversation = Conversation::visibleTo($request->user())->where('public_id', strtolower($id))->first();
        abort_unless($conversation, 404, 'Conversation not found.');

        return $conversation;
    }

    public function show(Request $request, string $conversation): ConversationResource
    {
        $conversation = $this->readableConversation($request, $conversation);
        $conversation = $this->summaries($request->user())->with(['patient.person', 'branch', 'participants.user.person', 'assignee.person'])->findOrFail($conversation->id);

        return new ConversationResource($conversation);
    }

    /** Messages newest first (keyset by serial id — a deterministic order, the cursor is the oldest message public id returned). */
    public function messages(Request $request, string $conversation): JsonResponse
    {
        $conversation = $this->readableConversation($request, $conversation);
        Presence::touch($request->user());
        $v = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE], 'cursor' => ['nullable', 'string', 'size:26'], 'after' => ['nullable', 'string', 'size:26', 'prohibits:cursor,q'], 'q' => ['nullable', 'string', 'max:120']]);
        $per = (int) ($v['per_page'] ?? 30);
        $context = ['conversation_id' => $conversation->public_id, 'patient_id' => $conversation->patient->public_id, 'branch_id' => $conversation->branch->legacy_ref];
        if (! empty($v['after'])) {
            // Realtime and polling sync: messages NEWER than `after` (a message of THIS conversation), oldest first. This is the one read
            // path used both after a socket signal and by the polling fallback, so both show the same projection.
            $after = ConversationMessage::where('conversation_id', $conversation->id)->where('public_id', strtolower($v['after']))->value('id');
            if ($after === null) throw \Illuminate\Validation\ValidationException::withMessages(['after' => 'Choose a message from this conversation.']);
            $rows = ConversationMessage::where('conversation_id', $conversation->id)->where('id', '>', $after)->with('sender.person')->orderBy('id')->limit($per + 1)->get();
            $page = $rows->take($per)->values();

            return response()->json(['data' => MessageResource::collection($page)->resolve($request), 'meta' => ['context' => $context, 'per_page' => $per, 'order' => 'oldest_first', 'more' => $rows->count() > $per]])->header('Cache-Control', 'private, no-store');
        }
        $query = ConversationMessage::where('conversation_id', $conversation->id);
        if (! empty($v['cursor'])) {
            // The cursor is looked up inside THIS conversation only: a message from elsewhere reveals nothing.
            $query->where('id', '<', ConversationMessage::where('conversation_id', $conversation->id)->select('id')->where('public_id', strtolower($v['cursor']))->limit(1));
        }
        $term = trim((string) ($v['q'] ?? ''));
        if ($term !== '') {
            $this->limitSearch($request);
            // The existing newest-first cursor now pages matching messages, including encrypted old history.
            // Decrypt in bounded chunks, stop after one result page plus lookahead; never export all history.
            $matches = new \Illuminate\Database\Eloquent\Collection();
            foreach ($query->lazyByIdDesc(200) as $message) {
                if (MessageSearch::contains($message->body, $term)) $matches->push($message);
                if ($matches->count() > $per) break;
            }
            $page = $matches->take($per)->values();
            $page->load('sender.person');
            return response()->json(['data' => MessageResource::collection($page)->resolve($request), 'meta' => [
                'context' => $context, 'per_page' => $per, 'next_cursor' => $matches->count() > $per ? $page->last()->public_id : null,
            ]])->header('Cache-Control', 'private, no-store');
        }
        $rows = $query->with('sender.person')->orderByDesc('id')->limit($per + 1)->get();
        $page = $rows->take($per)->values();

        return response()->json(['data' => MessageResource::collection($page)->resolve($request), 'meta' => ['context' => $context, 'per_page' => $per, 'next_cursor' => $rows->count() > $per ? $page->last()->public_id : null]])->header('Cache-Control', 'private, no-store');
    }

    public function send(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        abort_unless($conversation->accessibleTo($request->user()), 403);

        return $this->messaging->send($request->user(), $conversation, $request->validated('body'), $this->idempotencyKey($request, true));
    }

    public function read(Request $request, Conversation $conversation): JsonResponse
    {
        abort_unless($conversation->accessibleTo($request->user()), 403);
        $v = $request->validate([
            'up_to' => ['required', 'string', 'size:26'],
            ...array_fill_keys(['body', 'read_at', 'message_id', 'last_read_message_id', 'user_id', 'participant', 'participant_id', 'seen_at', 'delivered_at', 'status'], ['prohibited']),
        ]);
        $this->messaging->markRead($request->user(), $conversation, $v['up_to']);

        return response()->json(['data' => ['id' => $conversation->public_id, 'read' => true]]);
    }

    public function close(CloseConversationRequest $request, Conversation $conversation): JsonResponse
    {
        abort_unless($conversation->accessibleTo($request->user()), 403);

        return $this->messaging->close($request->user(), $conversation, (int) $request->validated('expected_revision'), $this->idempotencyKey($request, true));
    }

    /** Adds the viewer's unread count and the latest message time (no message text) to a conversation query. */
    private function limitSearch(Request $request): void
    {
        // Technical cost bound for decrypting history; keys never contain search text.
        $allowed = \Illuminate\Support\Facades\RateLimiter::attempt('m17-search:'.$request->user()->id, 30, fn () => true, 60);
        abort_unless($allowed, 429, 'Please wait a moment before searching again.');
    }

    private function summaries($user)
    {
        return Conversation::query()
            ->select('conversations.*')
            ->selectSub(DB::table('conversation_messages as m')->selectRaw('count(*)')->whereColumn('m.conversation_id', 'conversations.id')->where('m.sender_user_id', '<>', $user->id)
                ->whereRaw('m.id > coalesce((select p.last_read_message_id from conversation_participants p where p.conversation_id = conversations.id and p.user_id = ?), 0)', [$user->id]), 'unread_count')
            ->selectSub(DB::table('conversation_messages as m2')->selectRaw('max(m2.created_at)')->whereColumn('m2.conversation_id', 'conversations.id'), 'last_message_at');
    }
}
