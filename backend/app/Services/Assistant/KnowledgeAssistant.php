<?php

namespace App\Services\Assistant;

use App\Models\AssistantAnswer;
use App\Models\Branch;
use App\Models\Service;
use App\Services\Payment\PayMongoService;
use App\Support\Brand;
use App\Support\ClinicClock;
use Illuminate\Support\Collection;

/**
 * Knowledge mode of the Clinic Assistant (no AI, nothing leaves the clinic server). It answers only from:
 *   - live clinic records: services, branches (names, addresses, hours, closed days), accepted payment methods, the clinic's
 *     contact settings, and — for the signed-in Patient only — their own appointments and balance (AssistantTools);
 *   - the clinic's editable answers (assistant_answers, Administration → Assistant answers).
 * A question below the confidence threshold gets "did you mean" suggestions; an unknown clinic question is handed to the front
 * desk (never invented); a question that is not about the clinic is politely redirected. Actions are buttons only.
 */
final class KnowledgeAssistant
{
    public const ANSWER = 0.6;

    public const SUGGEST = 0.3;

    private const DAYS = [1 => 'Monday', 2 => 'Tuesday', 3 => 'Wednesday', 4 => 'Thursday', 5 => 'Friday', 6 => 'Saturday', 7 => 'Sunday'];

    /** Built-in topics: a suggested question (for "did you mean") and weighted phrases of canonical words. */
    private const TOPICS = [
        'my_appointment' => ['When is my next appointment?', ['my appointment' => 0.55, 'next appointment' => 0.6, 'next my' => 0.3]],
        'my_balance' => ['What is my balance?', ['balance' => 0.6, 'balance my' => 0.3, 'balance price' => 0.3, 'invoice my' => 0.6, 'pay my' => 0.3, 'receipt my' => 0.6]],
        'price' => ['How much does a treatment cost?', ['price' => 0.6, 'price service' => 0.2, 'price appointment' => 0.15]],
        'services' => ['What services do you offer?', ['service' => 0.65, 'service clinic' => 0.2, 'service what' => 0.2]],
        'branches' => ['Where are your branches?', ['branch' => 0.6, 'where' => 0.6, 'where clinic' => 0.3, 'branch where' => 0.3, 'how where' => 0.1]],
        'hours' => ['What are your clinic hours?', ['hours' => 0.65, 'open' => 0.45, 'closed' => 0.45, 'open hours' => 0.3, 'sunday' => 0.4, 'saturday' => 0.4, 'weekend' => 0.4, 'holiday' => 0.3, 'open clinic' => 0.2]],
        'booking' => ['How do I book an appointment?', ['book' => 0.65, 'appointment how' => 0.5, 'book how' => 0.2, 'appointment' => 0.25, 'book appointment' => 0.15]],
        'changes' => ['How do I reschedule or cancel?', ['cancel' => 0.7, 'reschedule' => 0.7, 'cancel appointment' => 0.2, 'reschedule appointment' => 0.2]],
        'payment' => ['How do I pay, and where is my receipt?', ['pay' => 0.6, 'pay how' => 0.5, 'receipt' => 0.6, 'invoice' => 0.35, 'invoice how' => 0.25]],
        'account' => ['How do the email code and sign-in work?', ['otp' => 0.65, 'signin' => 0.65, 'otp how' => 0.2, 'signin how' => 0.2, 'otp my' => 0.1]],
        'contact' => ['How can I contact the clinic?', ['contact' => 0.65, 'desk' => 0.7, 'contact clinic' => 0.2]],
        'thanks' => ['', ['thanks' => 0.8]],
        'hello' => ['', ['hello' => 0.7]],
    ];

    /** Words in a service name a Patient may use instead (English, Filipino, Taglish). */
    private const SERVICE_WORDS = [
        'prophylaxis' => ['cleaning', 'clean', 'linis', 'paglilinis', 'palinis', 'prophylaxis', 'prophy', 'oral prophylaxis'],
        'restoration' => ['filling', 'fillings', 'pasta', 'papasta', 'restoration', 'composite'],
        'extraction' => ['extraction', 'extract', 'bunot', 'pabunot', 'magpabunot', 'pull', 'tooth removal'],
        'root canal' => ['root canal', 'rootcanal'],
        'orthodontic' => ['braces', 'brace', 'ortho', 'orthodontic', 'orthodontics', 'adjustment'],
        'whitening' => ['whitening', 'pampaputi', 'whiten', 'bleaching'],
        'implant' => ['implant', 'implants'],
        'pediatric' => ['pediatric', 'pedia', 'kids', 'kid', 'child', 'children', 'bata', 'anak'],
        'tmd' => ['tmd', 'jaw pain', 'orofacial', 'tmj'],
        'follow-up' => ['follow up', 'followup', 'follow-up'],
        'dental consultation' => ['consultation', 'consult', 'konsulta', 'checkup', 'check up', 'check-up', 'patingin'],
    ];

    private ?Collection $branches = null;

    private ?Collection $entries = null;

    public function __construct(private readonly ?AssistantTools $tools = null) {}

    /**
     * @param  list<array{role:string, text:string}>  $history
     * @return array{answer:string, outcome:string, actions:list<array>, handoff:bool, suggestions:list<string>, confidence:float, topic:?string}
     */
    public function answer(string $message, array $history = []): array
    {
        $words = KnowledgeMatcher::canonical($message);
        $entities = $this->entities($message);
        [$topic, $confidence, $ranked] = $this->best($words, $entities);

        // A short follow-up ("how about in Guiguinto?", "sa Cardinal?", "and Saturday?") continues the previous question.
        if ($confidence < self::ANSWER && ($previous = $this->previousQuestion($history))) {
            $carried = array_merge(KnowledgeMatcher::canonical($previous), $words);
            // When the new message carries its own topic word ("And on Sunday?"), only topics it speaks to may win.
            [$t2, $c2] = $this->best($carried, $entities + $this->entities($previous), $words);
            // A very short follow-up ("And on Sunday?") needs less: the earlier question gives the rest of the meaning.
            $enough = $c2 >= self::ANSWER || ($c2 >= self::SUGGEST && count($words) <= 4);
            if ($enough && ($entities || array_intersect($words, ['sunday', 'saturday', 'weekend', 'holiday', 'open', 'closed', 'hours', 'price', 'where']))) {
                [$topic, $confidence, $words] = [$t2, max($c2, self::ANSWER), $carried];
                $entities += $this->entities($previous);
            }
        }
        // A service named on its own ("cleaning?", "pabunot") is a question about that service.
        if ($confidence < self::ANSWER && isset($entities['service'])) {
            [$topic, $confidence] = ['service_info', 0.7];
        }

        if ($confidence >= self::ANSWER) {
            return $this->respond($topic, $words, $entities) + ['confidence' => $confidence, 'topic' => $topic];
        }
        $suggestions = $this->suggestions($ranked);
        if ($confidence >= self::SUGGEST && $suggestions) {
            return ['answer' => 'I’m not sure I understood. Did you mean one of these?', 'outcome' => 'knowledge_suggest', 'actions' => [],
                'handoff' => false, 'suggestions' => $suggestions, 'confidence' => $confidence, 'topic' => null];
        }
        $desk = ['type' => 'contact_front_desk', 'label' => 'Message the front desk'];
        if ($this->aboutTheClinic($words)) {
            return ['answer' => 'I don’t have that information here, so I won’t guess. The front desk can answer it for you.', 'outcome' => 'knowledge_unknown',
                'actions' => [$desk], 'handoff' => true, 'suggestions' => $suggestions ?: $this->common(), 'confidence' => $confidence, 'topic' => null];
        }

        return ['answer' => 'I can only help with the clinic: our services, branches and hours, booking, your appointments and billing, and general dental care. What would you like to know?',
            'outcome' => 'refused_off_topic', 'actions' => [$desk], 'handoff' => false, 'suggestions' => $this->common(), 'confidence' => $confidence, 'topic' => null];
    }

    /** The clinic's own answers that best match a question (the AI mode's read-only `search_clinic_answers` tool). */
    public function search(string $question): array
    {
        $words = KnowledgeMatcher::canonical($question);
        $found = $this->entries()->map(fn (AssistantAnswer $e) => ['score' => $this->entryScore($words, $e), 'question' => $e->question, 'answer' => $e->answer])
            ->filter(fn ($r) => $r['score'] >= self::SUGGEST)->sortByDesc('score')->take(3)->values();

        return ['answers' => $found->map(fn ($r) => ['question' => $r['question'], 'answer' => $r['answer']])->all(),
            'note' => $found->isEmpty() ? 'The clinic has no approved answer for this; offer the front desk.' : 'Use only these answers; do not add facts.'];
    }

    /** The best topic or clinic answer for these words: [topic id, confidence, ranked list]. */
    private function best(array $words, array $entities, ?array $current = null): array
    {
        $scores = [];
        $restrict = false;
        if ($current !== null) {
            foreach (self::TOPICS as [, $phrases]) if (KnowledgeMatcher::score($current, $phrases) > 0) $restrict = true;
        }
        foreach (self::TOPICS as $id => [, $phrases]) {
            $scores[$id] = $restrict && KnowledgeMatcher::score($current, $phrases) == 0 ? 0.0 : KnowledgeMatcher::score($words, $phrases);
        }
        if (isset($scores['hello']) && count($words) > 5) $scores['hello'] = 0.0; // a greeting only when it is just a greeting
        foreach ($this->entries() as $entry) {
            if ($entry->branch_id && isset($entities['branch']) && $entities['branch']->id !== $entry->branch_id) continue;
            $scores['faq:'.$entry->public_id] = $this->entryScore($words, $entry);
        }
        arsort($scores);
        $topic = array_key_first($scores);

        return [$topic, $scores[$topic] ?? 0.0, $scores];
    }

    private function entryScore(array $words, AssistantAnswer $entry): float
    {
        $phrases = [];
        foreach ((array) $entry->keywords as $keyword) {
            $keyword = trim((string) $keyword);
            if ($keyword !== '') $phrases[$keyword] = 0.6; // a keyword the clinic chose is enough to answer
        }
        $score = KnowledgeMatcher::score($words, $phrases);
        $question = array_values(array_diff(array_unique(KnowledgeMatcher::canonical($entry->question)), self::STOP));
        if ($question) {
            $overlap = count(array_intersect($question, $words)) / count($question);
            $score += 0.5 * $overlap;
        }

        return min(1.0, round($score, 2));
    }

    private const STOP = ['a', 'an', 'the', 'is', 'are', 'do', 'does', 'i', 'can', 'what', 'my', 'clinic', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'ba', 'ang', 'ng', 'sa', 'po', 'na', 'ko', 'mga', 'how', 'teeth', 'dentist'];

    private function respond(string $topic, array $words, array $entities): array
    {
        if (str_starts_with($topic, 'faq:')) {
            $entry = $this->entries()->firstWhere('public_id', substr($topic, 4));

            return $this->reply($entry->answer, $this->actionsFor($entry->category, $entities), 'knowledge_answered');
        }
        $desk = ['type' => 'contact_front_desk', 'label' => 'Message the front desk'];
        $book = $this->bookAction($entities);

        return match ($topic) {
            'my_appointment' => $this->myAppointment(),
            'my_balance' => $this->myBalance(),
            'price' => $this->reply(($entities['service'] ?? null ? 'The price of '.$entities['service']->name.' is' : 'Treatment prices are')
                .' confirmed by the clinic, because they depend on what the dentist finds and does. You pay the appointment fee when booking online through GCash or card (credited to your invoice after the visit). For an estimate, message the front desk.', [$desk, $book]),
            'services' => $this->services(),
            'service_info' => $this->serviceInfo($entities['service']),
            'branches' => $this->branchesAnswer($entities['branch'] ?? null),
            'hours' => $this->hoursAnswer($words, $entities['branch'] ?? null),
            'booking' => $this->reply('Booking takes a few steps in this portal: choose a service, a branch (we can suggest the nearest), a dentist or “any available”, then a day and a time. You pay the appointment fee when booking online through GCash or card (fully refunded if cancelled at least 24 hours before). You’ll get a confirmation email.', [$book]),
            'changes' => $this->reply('Open My visits, choose the appointment, then Reschedule (pick a new day and time) or Cancel. The change is confirmed right away and you’ll get an email. If you need help, message the front desk.', [['type' => 'open_visits', 'label' => 'Open My visits'], $desk]),
            'payment' => $this->payment(),
            'account' => $this->reply('When you create an account, we email you a 6-digit code that is valid for '.(int) config('clinic.otp_ttl_minutes', 10).' minutes. Enter it to verify your email, then sign in with your email and password. No code? Check your spam folder, then use Resend code (after a minute). Forgot your password? Choose “Forgot password?” on the sign-in page and we’ll email you a code to set a new one.', [$desk]),
            'contact' => $this->contact($entities['branch'] ?? null),
            'thanks' => $this->reply('You’re welcome! Anything else I can help with?', []),
            'hello' => ['suggestions' => $this->common()] + $this->reply('Hello! I can help with our services, branches and hours, booking, and your own appointments and balance. What would you like to know?', []),
            default => $this->reply('The front desk can help you with that.', [$desk]),
        };
    }

    private function myAppointment(): array
    {
        if (! $this->tools) return $this->reply('[The patient’s own next appointment is shown here, from their record.]', [['type' => 'open_visits', 'label' => 'Open My visits']]);
        $upcoming = array_values(array_filter($this->tools->appointments()['appointments'], fn ($a) => $a['upcoming']));
        if (! $upcoming) return $this->reply('You have no upcoming appointment.', [['type' => 'open_booking', 'label' => 'Book an appointment']]);
        $next = end($upcoming);

        return $this->reply("Your next appointment: {$next['service']} on {$next['when']} at {$next['branch']}".($next['dentist'] ? " with {$next['dentist']}" : '').'.', [['type' => 'open_visits', 'label' => 'Open My visits']]);
    }

    private function myBalance(): array
    {
        if (! $this->tools) return $this->reply('[The patient’s own balance and invoices are shown here, from their record.]', [['type' => 'open_billing', 'label' => 'Open Billing']]);
        $billing = $this->tools->billing();
        $due = array_values(array_filter($billing['invoices'], fn ($i) => $i['status'] === 'Payment due'));

        return $this->reply($due
            ? 'Your balance due is '.$billing['total_balance_due'].' ('.implode(', ', array_map(fn ($i) => $i['invoice_number'].': '.$i['balance_due'], $due)).'). You can pay online in Billing.'
            : 'You have no balance due right now.'.($billing['invoices'] ? ' Your paid invoices and receipts are in Billing.' : ''), [['type' => 'open_billing', 'label' => 'Open Billing']]);
    }

    private function services(): array
    {
        $byCategory = Service::where('status', 'Active')->orderBy('category')->orderBy('name')->get()->groupBy('category');
        if ($byCategory->isEmpty()) return $this->reply('The list of services is not available right now. The front desk can tell you.', [['type' => 'contact_front_desk', 'label' => 'Message the front desk']]);
        $lines = $byCategory->map(fn ($list, $category) => $category.': '.$list->pluck('name')->implode(', '))->values()->implode('. ');

        return $this->reply("We offer — {$lines}. Prices are confirmed by the clinic; you receive the invoice after your visit.", [['type' => 'open_booking', 'label' => 'Book an appointment']]);
    }

    private function serviceInfo(Service $service): array
    {
        $text = $service->name.($service->description ? ': '.rtrim($service->description, '.').'.' : '.').' It usually takes about '.$service->duration_minutes.' minutes. Prices are confirmed by the clinic.';

        return $this->reply($text, [['type' => 'open_booking', 'label' => "Book {$service->name}", 'service' => $service->legacy_ref]]);
    }

    private function branchesAnswer(?Branch $branch): array
    {
        $list = $branch ? collect([$branch]) : $this->openBranches();
        if ($list->isEmpty()) return $this->reply('Branch details are not available right now. The front desk can help.', [['type' => 'contact_front_desk', 'label' => 'Message the front desk']]);
        $lines = $list->map(fn (Branch $b) => "{$b->name}: {$b->address}".($b->phone ? ", phone {$b->phone}" : '').($b->latitude !== null ? " (map: https://www.google.com/maps?q={$b->latitude},{$b->longitude})" : ''))->implode('. ');
        $intro = $branch ? '' : 'We have '.$list->count().' branches. ';

        return $this->reply($intro.$lines.'.', [$this->bookAction($branch ? ['branch' => $branch] : [])]);
    }

    private function hoursAnswer(array $words, ?Branch $branch): array
    {
        $list = $branch ? collect([$branch]) : $this->openBranches();
        if ($list->isEmpty()) return $this->reply('Clinic hours are not available right now. The front desk can help.', [['type' => 'contact_front_desk', 'label' => 'Message the front desk']]);
        $day = in_array('sunday', $words, true) ? 7 : (in_array('saturday', $words, true) ? 6 : null);
        if (in_array('holiday', $words, true)) {
            return $this->reply('Holiday schedules are not in my information. Please message the front desk to check a specific date.', [['type' => 'contact_front_desk', 'label' => 'Message the front desk']]);
        }
        $describe = function (Branch $b) use ($day, $words) {
            $span = fn (?array $h, int $d) => $h ? 'open on '.self::DAYS[$d].', '.$this->time($h['open']).' to '.$this->time($h['close']) : 'closed on '.self::DAYS[$d];
            if ($day) return $span($b->hoursOnDay($day), $day);
            if (in_array('weekend', $words, true)) return $span($b->hoursOnDay(6), 6).'; '.$span($b->hoursOnDay(7), 7);

            return \App\Support\BranchHours::summary($b);
        };
        $texts = $list->mapWithKeys(fn (Branch $b) => [$b->name => $describe($b)]);
        // The same hours everywhere are said once; otherwise branch by branch.
        $answer = $texts->count() > 1 && $texts->unique()->count() === 1
            ? 'All '.$texts->count().' branches: '.$texts->first().'.'
            : $texts->map(fn ($text, $name) => "{$name}: {$text}")->implode('. ').'.';

        return $this->reply($answer, [$this->bookAction($branch ? ['branch' => $branch] : [])]);
    }

    private function payment(): array
    {
        $methods = app(PayMongoService::class)->acceptedMethodNames();
        $online = $methods ? implode(', ', $methods) : 'GCash, Maya, or Card';

        return $this->reply("Yes, you pay the appointment fee when you book online through {$online} (PayMongo). It holds your slot for 15 minutes and is credited to your invoice after your visit. If you cancel at least 24 hours before, it is fully refunded. Remaining balances can be paid online in Billing or at the clinic.", [['type' => 'open_booking', 'label' => 'Book an appointment'], ['type' => 'open_billing', 'label' => 'Open Billing']]);
    }

    private function contact(?Branch $branch = null): array
    {
        $desk = ['type' => 'contact_front_desk', 'label' => 'Message the front desk'];
        $line = fn (Branch $b) => "{$b->name}: ".($b->phone ? "call {$b->phone}" : 'no phone on file').', '.($b->email ? "email {$b->email}" : 'no email on file');
        $list = $branch ? collect([$branch]) : $this->openBranches();
        if ($list->isEmpty()) {
            $c = Brand::forEmail();
            $ways = array_filter([$c['phone'] ? "call {$c['phone']}" : null, $c['email'] ? "email {$c['email']}" : null]);

            return $this->reply('You can message the front desk here and a staff member will reply'.($ways ? ', or '.implode(' or ', $ways) : '').'.', [$desk]);
        }
        $text = $list->map($line)->implode('. ').'.';

        return $this->reply('You can message the front desk here and a staff member will reply. '.$text, [$desk]);
    }

    /** The service and branch a message mentions (real records only). */
    private function entities(string $message): array
    {
        $text = ' '.KnowledgeMatcher::normalise($message).' ';
        $found = [];
        foreach ($this->openBranches() as $b) {
            $keys = array_filter([KnowledgeMatcher::normalise($b->name), KnowledgeMatcher::normalise((string) $b->city)]);
            foreach (preg_split('/\s+/', KnowledgeMatcher::normalise($b->name)) as $word) {
                if (strlen($word) >= 6 && ! in_array($word, ['dental', 'clinic', 'center', 'centre', 'branch'], true)) $keys[] = $word; // "cardinal", "guiguinto"
            }
            foreach ($keys as $key) {
                // A city shared by two branches does not pick one of them.
                if ($key === KnowledgeMatcher::normalise((string) $b->city) && $this->openBranches()->where('city', $b->city)->count() > 1) continue;
                if ($key !== '' && str_contains($text, " $key ")) { $found['branch'] = $b; break 2; }
            }
        }
        $services = Service::where('status', 'Active')->get();
        foreach ($services as $s) {
            if (str_contains($text, ' '.KnowledgeMatcher::normalise($s->name).' ')) { $found['service'] = $s; break; }
        }
        if (! isset($found['service'])) {
            foreach (self::SERVICE_WORDS as $inName => $said) {
                foreach ($said as $word) {
                    if (str_contains($text, ' '.KnowledgeMatcher::normalise($word).' ')) {
                        $match = $services->first(fn (Service $s) => str_contains(mb_strtolower($s->name), $inName));
                        if ($match) { $found['service'] = $match; break 2; }
                    }
                }
            }
        }

        return $found;
    }

    private function bookAction(array $entities): array
    {
        $action = ['type' => 'open_booking', 'label' => isset($entities['service']) ? 'Book '.$entities['service']->name : 'Book an appointment'];
        if (isset($entities['service'])) $action['service'] = $entities['service']->legacy_ref;
        if (isset($entities['branch'])) $action['branch'] = $entities['branch']->legacy_ref;

        return $action;
    }

    private function actionsFor(string $category, array $entities): array
    {
        return match ($category) {
            'booking', 'services', 'care', 'branches', 'hours', 'about' => [$this->bookAction($entities)],
            'payment' => [['type' => 'open_billing', 'label' => 'Open Billing']],
            'changes' => [['type' => 'open_visits', 'label' => 'Open My visits']],
            default => [['type' => 'contact_front_desk', 'label' => 'Message the front desk']],
        };
    }

    private function suggestions(array $ranked): array
    {
        $out = [];
        foreach ($ranked as $id => $score) {
            if ($score < 0.2 || count($out) >= 3) continue;
            $question = str_starts_with($id, 'faq:') ? $this->entries()->firstWhere('public_id', substr($id, 4))?->question : (self::TOPICS[$id][0] ?? '');
            if ($question) $out[] = $question;
        }

        return $out;
    }

    private function common(): array
    {
        return [self::TOPICS['booking'][0], self::TOPICS['hours'][0], self::TOPICS['my_balance'][0]];
    }

    private function aboutTheClinic(array $words): bool
    {
        return (bool) array_intersect($words, KnowledgeMatcher::concepts());
    }

    private function previousQuestion(array $history): ?string
    {
        foreach (array_reverse($history) as $turn) {
            if (($turn['role'] ?? '') === 'user' && trim((string) ($turn['text'] ?? '')) !== '') return mb_substr((string) $turn['text'], 0, 500);
        }

        return null;
    }

    private function entries(): Collection
    {
        // F8: the HMO answer names only HMOs the clinic verified (none until the Owner confirms the list).
        return $this->entries ??= AssistantAnswer::where('active', true)->where('draft', false)->get()->each(function (AssistantAnswer $e) {
            if ($e->seed_key === 'hmo' && ($names = \App\Http\Controllers\AcceptedHmoController::publicNames())) $e->answer .= ' HMOs the clinic has confirmed: '.implode(', ', $names).'.';
        });
    }

    private function openBranches(): Collection
    {
        return $this->branches ??= Branch::where('status', 'Open')->orderBy('legacy_ref')->get();
    }

    private function time($value): string
    {
        return ClinicClock::at(ClinicClock::today(), substr((string) $value, 0, 5))->format('g:i A');
    }

    private function reply(string $text, array $actions, string $outcome = 'knowledge_answered'): array
    {
        return ['answer' => $text, 'outcome' => $outcome, 'actions' => array_values(array_filter($actions)), 'handoff' => false, 'suggestions' => []];
    }
}
