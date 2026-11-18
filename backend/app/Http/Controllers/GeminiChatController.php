<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Models\Branch;
use App\Models\Service;
use App\Models\User;
use App\Services\Assistant\AssistantService;
use App\Services\Assistant\IntentGuard;
use App\Services\Assistant\KnowledgeMatcher;
use App\Support\Brand;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Controller for Clinic Chatbot integration with Google Gemini API (gemini-2.5-flash / gemini-1.5-flash).
 *
 * System prompt is grounded strictly in Dr. Dana E. Roxas Dental Clinic services, hours, branches, and policies.
 * Refuses medical/dental diagnoses with a mandatory disclaimer.
 * Features rate-limit (HTTP 429) backoff with graceful fallback to standard clinic assistant answers.
 */
class GeminiChatController extends Controller
{
    public const DEFAULT_MODEL = 'gemini-1.5-flash';
    public const BASE_ORIGIN = 'https://generativelanguage.googleapis.com';

    public const MEDICAL_DISCLAIMER = "Medical Disclaimer: I cannot provide dental or medical diagnosis, evaluate clinical conditions, or recommend prescription medications. Please consult Dr. Dana E. Roxas or our licensed dentists for an in-person examination and personalized diagnosis.";

    /**
     * POST /api/gemini/chat — Prompt-response handling.
     */
    public function chat(Request $request): JsonResponse
    {
        [$message, $history] = $this->validateChatInput($request);
        $apiKey = config('assistant.mode') === 'knowledge' ? '' : (string) config('services.gemini.api_key');
        if ($limited = $this->reserveQuestion($request->user(), $apiKey !== '')) return $limited;

        // Deterministic guard: emergency & medical diagnosis refusal
        if ($guard = $this->screenMessage($message)) {
            return response()->json(['data' => $guard]);
        }

        if ($apiKey === '') {
            return response()->json(['data' => $this->fallbackAnswer($message)]);
        }

        $model = (string) config('services.gemini.model', self::DEFAULT_MODEL);
        $systemPrompt = $this->buildSystemPrompt();
        $payload = $this->buildPayload($systemPrompt, $message, $history);

        $result = $this->callGeminiWithBackoff($model, $apiKey, $payload, $message);

        return response()->json(['data' => $result]);
    }

    /**
     * POST /api/gemini/stream — Server-Sent Events (SSE) streaming handling.
     */
    public function stream(Request $request): StreamedResponse|JsonResponse
    {
        [$message, $history] = $this->validateChatInput($request);
        $apiKey = config('assistant.mode') === 'knowledge' ? '' : (string) config('services.gemini.api_key');
        if ($limited = $this->reserveQuestion($request->user(), $apiKey !== '')) return $limited;

        // Deterministic guard: emergency & medical diagnosis refusal
        if ($guard = $this->screenMessage($message)) {
            return response()->stream(function () use ($guard) {
                $this->sendSse('delta', ['text' => $guard['answer']]);
                $this->sendSse('done', $guard);
            }, 200, $this->sseHeaders());
        }

        if ($apiKey === '') {
            $fallback = $this->fallbackAnswer($message);
            return response()->stream(function () use ($fallback) {
                $this->sendSse('delta', ['text' => $fallback['answer']]);
                $this->sendSse('done', $fallback);
            }, 200, $this->sseHeaders());
        }

        $model = (string) config('services.gemini.model', self::DEFAULT_MODEL);
        $systemPrompt = $this->buildSystemPrompt();
        $payload = $this->buildPayload($systemPrompt, $message, $history);

        return response()->stream(function () use ($model, $apiKey, $payload, $message) {
            $endpoint = self::BASE_ORIGIN . "/v1beta/models/{$model}:streamGenerateContent?alt=sse&key={$apiKey}";
            try {
                $response = Http::withHeaders(['Content-Type' => 'application/json'])
                    ->withOptions(['stream' => true])
                    ->timeout((int) config('services.gemini.timeout_seconds', 25))
                    ->post($endpoint, $payload);

                if ($response->status() === 429) {
                    // Backoff retry once
                    usleep(500000);
                    $response = Http::withHeaders(['Content-Type' => 'application/json'])
                        ->withOptions(['stream' => true])
                        ->timeout((int) config('services.gemini.timeout_seconds', 25))
                        ->post($endpoint, $payload);
                }

                if (! $response->successful()) {
                    Log::warning('gemini.stream_failed', ['status' => $response->status()]);
                    $fallback = $this->fallbackAnswer($message, $response->status() === 429);
                    $this->sendSse('delta', ['text' => $fallback['answer']]);
                    $this->sendSse('done', $fallback);
                    return;
                }

                $body = $response->toPsrResponse()->getBody();
                $buffer = '';
                $completeText = '';

                while (! $body->eof()) {
                    $buffer .= $body->read(1024);
                    while (($pos = strpos($buffer, "\n")) !== false) {
                        $line = rtrim(substr($buffer, 0, $pos), "\r");
                        $buffer = substr($buffer, $pos + 1);

                        if (str_starts_with($line, 'data:')) {
                            $jsonStr = trim(substr($line, 5));
                            $data = json_decode($jsonStr, true);
                            $chunk = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
                            if ($chunk !== '') {
                                $completeText .= $chunk;
                                $this->sendSse('delta', ['text' => $chunk]);
                            }
                        }
                    }
                }

                $this->sendSse('done', [
                    'answer' => trim($completeText),
                    'outcome' => 'answered',
                    'mode' => 'gemini',
                ]);
            } catch (\Throwable $e) {
                Log::warning('gemini.stream_exception');
                $fallback = $this->fallbackAnswer($message);
                $this->sendSse('delta', ['text' => $fallback['answer']]);
                $this->sendSse('done', $fallback);
            }
        }, 200, $this->sseHeaders());
    }

    protected function reserveQuestion(User $user, bool $usesProvider): ?JsonResponse
    {
        $accepted = DB::transaction(function () use ($user, $usesProvider) {
            User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            if (AssistantService::usedToday($user) >= (int) config('assistant.daily_cap')) return false;

            // Charge once before processing, even for a fallback, refusal or disconnected stream.
            // Record no question, history, generated text or personal details.
            DB::table('assistant_usage')->insert([
                'user_id' => $user->id, 'clinic_date' => ClinicClock::today(),
                'mode' => $usesProvider ? 'ai' : 'knowledge', 'outcome' => 'gemini_request',
                'created_at' => now()->format('Y-m-d H:i:sP'),
            ]);

            return true;
        });

        return $accepted ? null : response()->json([
            'message' => 'You have reached today?s limit for the assistant. You can still message the front desk.',
            'code' => 'assistant_daily_cap',
        ], 429);
    }

    private function validateChatInput(Request $request): array
    {
        abort_unless($request->user()?->role === Role::Patient && $request->user()->patient !== null, 403);
        $extra = array_diff(array_keys($request->all()), ['message', 'history']);
        if ($extra) {
            throw ValidationException::withMessages([reset($extra) => 'Only a message and this chat\'s history can be sent to the assistant.']);
        }
        $v = $request->validate([
            'message' => ['required', 'string', 'min:2', 'max:1000'],
            'history' => ['sometimes', 'array', 'max:20'],
            'history.*' => ['array:role,text'],
            'history.*.role' => ['required_with:history', 'in:user,assistant,model'],
            'history.*.text' => ['required_with:history', 'string', 'max:1000'],
        ]);

        $message = trim(preg_replace('/\s+/u', ' ', $v['message']));
        if (mb_strlen($message) < 2) {
            throw ValidationException::withMessages(['message' => 'Type a question for the assistant.']);
        }

        return [$message, $v['history'] ?? []];
    }

    private function screenMessage(string $message): ?array
    {
        $brand = Brand::forEmail();
        $phone = $brand['phone'] ?: 'the clinic';

        // Check medical diagnosis refusal first
        $screen = IntentGuard::screen($message);
        if ($screen === IntentGuard::MEDICAL) {
            return [
                'answer' => self::MEDICAL_DISCLAIMER . " You can book an appointment with our dentists or message the front desk for clinic inquiries.",
                'outcome' => 'refused_medical',
                'mode' => 'guard',
                'disclaimer' => self::MEDICAL_DISCLAIMER,
                'handoff' => true,
            ];
        }

        if ($screen === IntentGuard::EMERGENCY) {
            return [
                'answer' => "This sounds like an urgent dental condition. Please call the clinic immediately at {$phone}, or proceed to the nearest emergency hospital if pain or bleeding is severe and getting worse.",
                'outcome' => 'emergency',
                'mode' => 'guard',
                'handoff' => true,
            ];
        }

        return null;
    }

    public function buildSystemPrompt(): string
    {
        $brand = Brand::forEmail();
        $name = $brand['name'] ?: 'Dr. Dana E. Roxas Dental Clinic';
        $phone = $brand['phone'] ?: 'the clinic';
        $email = $brand['email'] ?: 'Ask the front desk for the clinic?s contact details.';

        // Branches
        try {
            $branches = Branch::where('status', 'Open')->get();
            $branchLines = [];
            foreach ($branches as $b) {
                $branchLines[] = "- {$b->name}: {$b->address}" . ($b->phone ? " (Tel: {$b->phone})" : '');
            }
            $branchStr = $branchLines ? implode("\n", $branchLines) : "- Branch details are unavailable. Ask the front desk.";
        } catch (\Throwable) {
            $branchStr = "- Branch details are unavailable. Ask the front desk.";
        }

        // Services
        try {
            $services = Service::where('status', 'Active')->get();
            $serviceLines = [];
            foreach ($services as $s) {
                $serviceLines[] = "- {$s->name}" . ($s->description ? ": {$s->description}" : '');
            }
            $serviceStr = $serviceLines ? implode("\n", $serviceLines) : "- Service details are unavailable. Ask the front desk.";
        } catch (\Throwable) {
            $serviceStr = "- Service details are unavailable. Ask the front desk.";
        }

        $clock = ClinicClock::now()->format('l, F j, Y g:i A');

        return <<<PROMPT
You are the official AI Assistant for {$name}.
Official phone: {$phone}
Official email: {$email}
Current Manila time: {$clock}

CLINIC SERVICES:
{$serviceStr}

CLINIC BRANCHES:
{$branchStr}

CLINIC POLICIES:
- Appointments: Book online or at the clinic front desk. Real-time calendar availability is used.
- Cancellation & Refunds: Full refund if cancelled 24+ hours before the scheduled appointment.
- Payments: Accepts PayMongo online payments (GCash, credit cards, debit cards) and direct clinic payments.
- Exact procedure pricing is determined during doctor consultation; no unverified prices should be quoted.

CRITICAL MEDICAL & ETHICAL RULES:
1. NEVER PROVIDE MEDICAL OR DENTAL DIAGNOSES. Do not attempt to diagnose conditions, evaluate tooth decay, prescribe antibiotics or pain medications, or recommend specific dosages.
2. If the user asks for a medical or dental diagnosis, symptom analysis, or drug prescription, you MUST refuse and include the standard disclaimer:
   "{$this->medicalDisclaimer()}"
3. In case of acute emergencies (severe unbearable pain, heavy bleeding, facial trauma), urge them to contact {$phone} immediately or visit the emergency room.
4. Keep replies polite, warm, concise (2-4 sentences), and grounded exclusively in verified clinic facts. Answer in the patient's language (English, Filipino, or Taglish).
PROMPT;
    }

    private function medicalDisclaimer(): string
    {
        return self::MEDICAL_DISCLAIMER;
    }

    private function buildPayload(string $systemPrompt, string $message, array $history): array
    {
        $contents = [];
        foreach ($history as $turn) {
            $role = ($turn['role'] ?? '') === 'assistant' || ($turn['role'] ?? '') === 'model' ? 'model' : 'user';
            $text = trim((string) ($turn['text'] ?? $turn['content'] ?? ''));
            if ($text !== '') {
                $contents[] = [
                    'role' => $role,
                    'parts' => [['text' => $text]],
                ];
            }
        }

        $contents[] = [
            'role' => 'user',
            'parts' => [['text' => $message]],
        ];

        return [
            'system_instruction' => [
                'parts' => [
                    ['text' => $systemPrompt],
                ],
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.2,
                'maxOutputTokens' => 600,
            ],
        ];
    }

    private function callGeminiWithBackoff(string $model, string $apiKey, array $payload, string $userMessage): array
    {
        $endpoint = self::BASE_ORIGIN . "/v1beta/models/{$model}:generateContent?key={$apiKey}";

        try {
            $response = Http::withHeaders(['Content-Type' => 'application/json'])
                ->timeout((int) config('services.gemini.timeout_seconds', 25))
                ->post($endpoint, $payload);

            // Rate limit (HTTP 429) backoff retry once
            if ($response->status() === 429) {
                Log::warning('gemini.rate_limited_retry', ['status' => 429]);
                usleep(500000); // 500ms backoff
                $response = Http::withHeaders(['Content-Type' => 'application/json'])
                    ->timeout((int) config('services.gemini.timeout_seconds', 25))
                    ->post($endpoint, $payload);
            }

            if ($response->status() === 429) {
                Log::warning('gemini.rate_limited_exhausted');
                return $this->fallbackAnswer($userMessage, true);
            }

            if (! $response->successful()) {
                Log::warning('gemini.call_failed', ['status' => $response->status()]);
                return $this->fallbackAnswer($userMessage);
            }

            $data = $response->json();
            $text = trim((string) ($data['candidates'][0]['content']['parts'][0]['text'] ?? ''));

            if ($text === '') {
                return $this->fallbackAnswer($userMessage);
            }

            return [
                'answer' => $text,
                'outcome' => 'answered',
                'mode' => 'gemini',
            ];
        } catch (\Throwable $e) {
            Log::warning('gemini.exception');
            return $this->fallbackAnswer($userMessage);
        }
    }

    public function fallbackAnswer(string $message, bool $isRateLimited = false): array
    {
        $brand = Brand::forEmail();
        $name = $brand['name'] ?: 'Dr. Dana E. Roxas Dental Clinic';
        $phone = $brand['phone'] ?: 'the clinic';

        $prefix = $isRateLimited
            ? "Our AI assistant is currently experiencing high demand. Here is official information from {$name}:\n\n"
            : "";

        try {
            $words = KnowledgeMatcher::canonical($message);
            $answers = DB::table('assistant_answers')->where('active', true)->where('draft', false)->get();

            $bestScore = 0.0;
            $bestAnswer = null;

            foreach ($answers as $row) {
                $kw = json_decode($row->keywords ?? '[]', true) ?: [];
                $phrases = array_fill_keys($kw, 0.5);
                $qWords = KnowledgeMatcher::canonical($row->question ?? '');
                foreach ($qWords as $qw) {
                    $phrases[$qw] = 0.4;
                }
                $score = KnowledgeMatcher::score($words, $phrases);
                if ($score > $bestScore && $score >= 0.3) {
                    $bestScore = $score;
                    $bestAnswer = $row->answer;
                }
            }

            if ($bestAnswer) {
                return [
                    'answer' => $prefix . $bestAnswer,
                    'outcome' => 'fallback_knowledge',
                    'mode' => 'knowledge_fallback',
                ];
            }
        } catch (\Throwable) {
            // DB table might not have answers seeded
        }

        // Standard clinic assistant fallback
        return [
            'answer' => $prefix . "Welcome to {$name}. You can book your appointments, manage invoices, or contact our front desk at {$phone}. For dental evaluations, please schedule a consultation visit.",
            'outcome' => 'fallback_standard',
            'mode' => 'knowledge_fallback',
        ];
    }

    private function sendSse(string $event, array $data): void
    {
        echo "event: {$event}\ndata: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }

    private function sseHeaders(): array
    {
        return [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-store',
            'X-Accel-Buffering' => 'no',
        ];
    }
}
