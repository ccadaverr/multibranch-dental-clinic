<?php

namespace App\Services\Messaging;

use App\Enums\Role;
use App\Events\Messaging\ConversationChanged;
use App\Events\Messaging\MessagePosted;
use App\Events\Messaging\ReadAdvanced;
use App\Http\Resources\MessageResource;
use App\Models\Branch;
use App\Models\CommandKey;
use App\Models\Conversation;
use App\Models\ConversationMessage;
use App\Models\ConversationParticipant;
use App\Models\DentistProfile;
use App\Models\MailDispatch;
use App\Models\Patient;
use App\Models\User;
use App\Services\Audit\AuditService;
use App\Services\Mail\MailOutbox;
use App\Services\Visits\VisitCommandException;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

// M17 named commands. Human, in-app messages. The sender is always the authenticated account; every command re-checks access under the
// conversation lock.
//   start:  a Patient writes to the front desk of a branch (Phase 2 decision 3). Their open conversation at that branch is reused.
//   send:   post to an OPEN conversation (Idempotency-Key required). Branch Staff replying join as participants; the first Staff reply
//           becomes the participant of record.
//   read:   moves THIS account's read marker forward to a message of this conversation (in-application read state only).
//   close:  Staff or Dentist participants end the conversation. No reopen (no policy) and no Patient close.
//   addDentist: Staff bring in a Dentist assigned to the conversation's branch.
// Message text is encrypted at rest (ConversationMessage) and never stored in plain form elsewhere: idempotency records keep the response
// WITHOUT the text (it is re-attached on the way out) and the request fingerprint is an HMAC, not a plain hash. Realtime events and the
// offline email alert carry no text. M22 records structural events only (started, assigned, participant added, closed) — not a transcript.
final class MessagingService
{
    private const ATTEMPTS = 3;

    public function __construct(private readonly AuditService $audit, private readonly MailOutbox $outbox) {}

    public function start(User $actor, Branch $branch, string $body, string $key): JsonResponse
    {
        $payload = ['branch' => $branch->id, 'body' => self::fingerprint($body)];

        return $this->withBodies(IdempotentCommand::run(
            CommandKey::class, $actor, $key, 'conversation.start', $payload,
            function () use ($actor, $branch, $body) {
                $patient = Patient::whereKey($actor->patient?->id ?? 0)->lockForUpdate()->first();
                if (! $patient) throw new VisitCommandException(403, 'forbidden', 'Only a Patient can start a conversation.');
                $conversation = Conversation::where('patient_id', $patient->id)->where('branch_id', $branch->id)->where('status', 'Open')->orderByDesc('id')->lockForUpdate()->first();
                $started = ! $conversation;
                if ($started) {
                    $conversation = Conversation::create(['patient_id' => $patient->id, 'branch_id' => $branch->id, 'context' => 'Message to the front desk', 'status' => 'Open', 'revision' => 1, 'created_by_user_id' => $actor->id]);
                    ConversationParticipant::create(['conversation_id' => $conversation->id, 'user_id' => $actor->id, 'created_at' => ClinicClock::now()]);
                    $this->audit->recordAdministrative('conversation.started', $actor, $conversation, ['branch' => $branch->public_id]);
                }
                $message = $this->post($conversation, $actor, $body);
                if ($started) $this->changed($conversation, 'started');

                return [['data' => ['conversation' => ['id' => $conversation->public_id, 'reused' => ! $started], 'message' => $this->projection($message, $actor)]], 201];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            fn (QueryException $e) => in_array($e->getCode(), ['40P01', '40001'], true) ? throw new VisitCommandException(409, 'conflict', 'Another request changed this conversation at the same time. Try again.') : null,
            self::ATTEMPTS,
        ), 'message');
    }

    public function send(User $actor, Conversation $conversation, string $body, string $key): JsonResponse
    {
        if (! app(ConversationDentistAccess::class)->enforced()) return $this->sendCommand($actor, $conversation, $body, $key);
        // Include idempotent receipt recovery in the same authorization lock; a revoked sender cannot recover old message text.
        return \Illuminate\Support\Facades\DB::transaction(function () use ($actor, $conversation, $body, $key) {
            $locked = Conversation::whereKey($conversation->id)->lockForUpdate()->firstOrFail();
            $currentActor = User::whereKey($actor->id)->lockForUpdate()->first();
            if (! $currentActor || $currentActor->account_status !== 'Active') throw new VisitCommandException(403, 'forbidden', 'This conversation is outside your access.');
            $current = $this->lock($currentActor, $locked);
            return $this->sendCommand($currentActor, $current, $body, $key)->header('Cache-Control', 'private, no-store');
        }, self::ATTEMPTS);
    }

    private function sendCommand(User $actor, Conversation $conversation, string $body, string $key): JsonResponse
    {
        $payload = ['conversation' => $conversation->id, 'body' => self::fingerprint($body)];

        return $this->withBodies(IdempotentCommand::run(
            CommandKey::class, $actor, $key, 'conversation.send', $payload,
            function () use ($actor, $conversation, $body) {
                $current = $this->lock($actor, $conversation);
                if ($current->status !== 'Open') {
                    throw VisitCommandException::rule('conversation_closed', 'This conversation is closed and cannot receive new messages.', 'conversation');
                }
                if ($actor->role === Role::Dentist) {
                    $grants = app(ConversationDentistAccess::class);
                    if ($grants->enforced() && ! $grants->permits($actor, $current)) {
                        throw new VisitCommandException(403, 'forbidden', 'Your conversation grant is no longer active.');
                    }
                    $activeDentistId = ConversationParticipant::where('conversation_id', $current->id)
                        ->whereIn('user_id', User::where('role', Role::Dentist->value)->select('id'))
                        ->orderByDesc('created_at')
                        ->orderByDesc('id')
                        ->value('user_id');
                    if (! $grants->enforced() && $activeDentistId && $activeDentistId !== $actor->id) {
                        throw new VisitCommandException(403, 'forbidden', 'Only the currently assigned Dentist can post messages to this conversation.');
                    }
                }
                $message = $this->post($current, $actor, $body);

                // resolve(), not response(): additional() values would otherwise be merged into the JSON (an internal user id).
                return [['data' => $this->projection($message, $actor)], 201];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            fn (QueryException $e) => in_array($e->getCode(), ['40P01', '40001'], true) ? throw new VisitCommandException(409, 'conflict', 'Another request changed this conversation at the same time. Try again.') : null,
            self::ATTEMPTS,
        ), null);
    }

    /**
     * Moves the actor's own read marker forward to the named message (public id). A message that is not in THIS conversation — foreign,
     * unknown or malformed — is refused with the same answer in every case, so nothing about another conversation is revealed. Ordering
     * is the serial id (never a timestamp). A marker at or behind the current one changes nothing. Reading a closed conversation is allowed.
     */
    public function markRead(User $actor, Conversation $conversation, string $upToPublicId): void
    {
        $this->inTransaction(function () use ($actor, $conversation, $upToPublicId) {
            $current = $this->lock($actor, $conversation);
            $target = ConversationMessage::where('conversation_id', $current->id)->where('public_id', strtolower($upToPublicId))->value('id');
            if ($target === null) {
                throw VisitCommandException::rule('message_not_in_conversation', 'Choose a message from this conversation.', 'up_to');
            }
            // Branch Staff who open a conversation get their own participant row so their read state can be kept.
            if ($actor->role === Role::Staff) $this->join($current, $actor);
            $moved = ConversationParticipant::where('conversation_id', $current->id)->where('user_id', $actor->id)
                ->where(fn ($q) => $q->whereNull('last_read_message_id')->orWhere('last_read_message_id', '<', $target))
                ->update(['last_read_message_id' => $target, 'last_read_at' => ClinicClock::now()]);
            if ($moved) RealtimeEvents::afterCommit(new ReadAdvanced($actor->public_id, $current->public_id, strtolower($upToPublicId)));
        });
    }

    public function close(User $actor, Conversation $conversation, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['conversation' => $conversation->id, 'expected_revision' => $expectedRevision];

        return IdempotentCommand::run(
            CommandKey::class, $actor, $key, 'conversation.close', $payload,
            function () use ($actor, $conversation, $expectedRevision) {
                if (! in_array($actor->role, [Role::Staff, Role::Dentist], true)) {
                    throw new VisitCommandException(403, 'forbidden', 'Only clinic participants can close a conversation.');
                }
                $current = $this->lock($actor, $conversation);
                if ($current->status === 'Closed') {
                    return [['data' => ['id' => $current->public_id, 'status' => 'Closed', 'revision' => $current->revision]], 200];
                }
                if ($current->revision !== $expectedRevision) {
                    throw new VisitCommandException(409, 'stale_revision', 'This conversation changed after it was opened. Reload it before trying again.');
                }
                $current->update(['status' => 'Closed', 'revision' => $current->revision + 1, 'closed_at' => ClinicClock::now(), 'closed_by_user_id' => $actor->id]);
                $this->audit->recordAdministrative('conversation.closed', $actor, $current);
                $this->changed($current, 'closed');

                return [['data' => ['id' => $current->public_id, 'status' => 'Closed', 'revision' => $current->revision]], 200];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            null,
            self::ATTEMPTS,
        );
    }

    /** Legacy participant mutation cannot establish the approved immutable conversation grant. */
    public function addDentist(User $actor, Conversation $conversation, string $dentistUserPublicId): bool
    {
        if ($actor->role !== Role::Staff) throw new VisitCommandException(403, 'forbidden', 'Only authorized Staff can reassign a conversation.');
        throw new VisitCommandException(409, 'conversation_grant_required', 'Use an authorized reassignment with a reason and current revision.');
    }

    /** Dentists who may be added: Active accounts assigned to the conversation's branch. */
    public function dentistOptions(Conversation $conversation): array
    {
        $activeDentistId = ConversationParticipant::where('conversation_id', $conversation->id)
            ->whereIn('user_id', User::where('role', Role::Dentist->value)->select('id'))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->value('user_id');
        if (app(ConversationDentistAccess::class)->schemaInstalled()) {
            $activeDentistId = \App\Models\ConversationDentistGrant::whereKey($conversation->active_dentist_grant_id)->value('dentist_user_id');
        }

        return User::where('role', Role::Dentist->value)->where('account_status', 'Active')
            ->whereIn('person_id', DentistProfile::whereHas('branches', fn ($q) => $q->where('branches.id', $conversation->branch_id))->select('person_id'))
            ->with('person')->get()
            ->map(fn (User $u) => ['id' => $u->public_id, 'name' => $u->person?->fullName(), 'participant' => $u->id === $activeDentistId])
            ->sortBy('name')->values()->all();
    }

    /** Writes one message under the conversation lock: Staff join + participant of record, read marker, offline alert, realtime signal. */
    private function post(Conversation $conversation, User $actor, string $body): ConversationMessage
    {
        if ($actor->role === Role::Staff) {
            $this->join($conversation, $actor);
            if (! $conversation->assigned_user_id) {
                $conversation->update(['assigned_user_id' => $actor->id]);
                $this->audit->recordAdministrative('conversation.assigned', $actor, $conversation);
                $this->changed($conversation, 'assigned');
            }
        }
        $message = ConversationMessage::create(['conversation_id' => $conversation->id, 'sender_user_id' => $actor->id, 'body' => $body, 'created_at' => ClinicClock::now()]);
        // Sending a message means the sender has seen everything up to it.
        ConversationParticipant::where('conversation_id', $conversation->id)->where('user_id', $actor->id)->update(['last_read_message_id' => $message->id, 'last_read_at' => ClinicClock::now()]);
        $this->alertPatientIfOffline($conversation, $message, $actor);
        if ($actor->role !== Role::Patient) app(\App\Services\Notifications\NotificationCenter::class)->messageReceived($conversation, $message->id);
        $grantAccess = app(ConversationDentistAccess::class);
        if ($grantAccess->schemaInstalled() && $conversation->active_dentist_grant_id) {
            $grant = \App\Models\ConversationDentistGrant::find($conversation->active_dentist_grant_id);
            $recipient = $grant ? User::find($grant->dentist_user_id) : null;
            if ($recipient && $recipient->id !== $actor->id && $grantAccess->permits($recipient, $conversation)) {
                app(\App\Services\Notifications\NotificationCenter::class)->staffNotice($recipient, 'message_received', 'New conversation message', null,
                    'messages', $conversation->public_id, 'conversation_message:'.$message->public_id.':'.$recipient->public_id);
            }
        }
        RealtimeEvents::afterCommit(new MessagePosted($conversation->public_id, $message->public_id, $actor->role->value, $conversation->branch->public_id, $this->personalChannels($conversation)));

        return $message;
    }

    /**
     * Offline alert (M18, retryable outbox — the email carries no message text, so nothing secret is stored). Sent to the Patient when
     * the clinic writes and the Patient is not in the app, at most once per conversation per messaging.alert_cooldown_minutes (default
     * 15). Runs under the conversation lock, so a burst of messages cannot race past the window. Skipped at send time if the Patient has
     * already read the message.
     */
    private function alertPatientIfOffline(Conversation $conversation, ConversationMessage $message, User $actor): void
    {
        if ($actor->role === Role::Patient) return;
        $patientUser = $conversation->patient?->user;
        if (! $patientUser || $patientUser->account_status !== 'Active' || ! $patientUser->email_verified_at || Presence::isOnline($patientUser)) return;
        $since = now()->subMinutes(max(1, (int) config('messaging.alert_cooldown_minutes', 15)))->toIso8601String();
        $recent = MailDispatch::where('purpose', 'message_alert')->where('subject_type', 'conversation')->where('subject_public_id', $conversation->public_id)
            ->where('recipient_user_id', $patientUser->id)->where('created_at', '>=', $since)->exists();
        if ($recent) return;
        $this->outbox->queue('message_alert', "message_alert:{$conversation->public_id}:{$message->public_id}", $conversation, $message->id, $patientUser, $actor);
    }

    /** Adds a participant row if missing. @return bool whether a row was added */
    private function join(Conversation $conversation, User $user): bool
    {
        if (ConversationParticipant::where('conversation_id', $conversation->id)->where('user_id', $user->id)->exists()) return false;
        ConversationParticipant::create(['conversation_id' => $conversation->id, 'user_id' => $user->id, 'created_at' => ClinicClock::now()]);

        return true;
    }

    private function changed(Conversation $conversation, string $change): void
    {
        RealtimeEvents::afterCommit(new ConversationChanged($conversation->public_id, $change, $conversation->status, $conversation->branch->public_id, $this->personalChannels($conversation)));
    }

    /** Patient and Dentist participants are notified on their own channel; branch Staff through the branch inbox channel. */
    private function personalChannels(Conversation $conversation): array
    {
        return User::whereIn('id', ConversationParticipant::where('conversation_id', $conversation->id)->select('user_id'))
            ->whereIn('role', [Role::Patient->value, Role::Dentist->value])->get()->filter(fn ($user) => $conversation->accessibleTo($user))->pluck('public_id')->values()->all();
    }

    private function projection(ConversationMessage $message, User $viewer): array
    {
        return (new MessageResource($message->load('sender.person')))->additional(['viewer' => $viewer->id, 'without_body' => true])->resolve();
    }

    /** Re-attaches the decrypted text to a stored (text-free) response — identical for the first response and for an idempotent replay. */
    private function withBodies(JsonResponse $response, ?string $path): JsonResponse
    {
        $data = $response->getData(true);
        $node = $path ? ($data['data'][$path] ?? null) : ($data['data'] ?? null);
        if (! is_array($node) || ! isset($node['id'])) return $response;
        $body = ConversationMessage::where('public_id', $node['id'])->first()?->body;
        $node = ['id' => $node['id'], 'body' => $body] + $node;
        if ($path) $data['data'][$path] = $node; else $data['data'] = $node;

        return $response->setData($data);
    }

    /** Request fingerprint for idempotency: keyed (HMAC) so the stored hash cannot be brute-forced back into a short message. */
    private static function fingerprint(string $body): string
    {
        return hash_hmac('sha256', $body, (string) config('app.key'));
    }

    private function inTransaction(Closure $work): void
    {
        \Illuminate\Support\Facades\DB::transaction($work, self::ATTEMPTS);
    }

    /** Locks the conversation and re-checks access (role link, branch scope, participation) under the lock. */
    private function lock(User $actor, Conversation $conversation): Conversation
    {
        $current = Conversation::whereKey($conversation->id)->lockForUpdate()->firstOrFail();
        if (! $current->accessibleTo($actor)) {
            throw new VisitCommandException(403, 'forbidden', 'This conversation is outside your access.');
        }

        return $current;
    }
}
