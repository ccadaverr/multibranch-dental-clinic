<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Models\AssistantAnswer;
use App\Models\CommandKey;
use App\Support\IdempotentCommand;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use App\Models\Branch;
use App\Services\Assistant\KnowledgeAssistant;
use App\Services\Audit\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Administration → Assistant answers (Owner only): the clinic's own answers that the Clinic Assistant gives in knowledge mode.
 * List, add, edit, confirm (no longer a draft), deactivate and test. Every change is audited (field names only, never the text).
 * Optimistic concurrency: an edit carries the revision it was based on. Nothing is ever deleted: an answer is deactivated.
 */
class AssistantAnswerController extends Controller
{
    use ReadsIdempotencyKey;

    public function index(): JsonResponse
    {
        $rows = AssistantAnswer::with('branch')->orderByDesc('draft')->orderBy('category')->orderBy('question')->get();

        return response()->json(['data' => $rows->map(fn ($a) => $this->view($a))->values(),
            'meta' => ['drafts' => $rows->where('active', true)->where('draft', true)->count(), 'categories' => AssistantAnswer::CATEGORIES]]);
    }

    public function store(Request $request): JsonResponse
    {
        return \App\Support\CommandActor::run($request->user(), function ($actor) use ($request) {
            $data = $this->validated($request, true);
            \App\Support\SelectionDetailsSchema::requireRequested($data, ['category_detail']);
            if (! \App\Support\SelectionDetailsSchema::available()) {
                unset($data['category_detail']);
            }
            return IdempotentCommand::run(CommandKey::class, $actor, $this->idempotencyKey($request), 'assistant.answer.create', $data, function () use ($data, $request, $actor) {
                $answer = new AssistantAnswer($data);
                $answer->updated_by = $actor->id;
                $answer->save();
                app(AuditService::class)->recordAdministrative('assistant.answer.created', $actor, $answer, ['category' => $answer->category, 'draft' => $answer->draft]);

                return [['data' => $this->view($answer->load('branch'))], 201];
            }, fn () => new ConflictHttpException('This request key belongs to a different answer.'));

        });
    }

    public function update(Request $request, AssistantAnswer $assistantAnswer): JsonResponse
    {
        return \App\Support\CommandActor::run($request->user(), function ($actor) use ($request, $assistantAnswer) {
            $data = $this->validated($request, false);
            $result = DB::transaction(function () use ($data, $request, $assistantAnswer, $actor) {
                $answer = AssistantAnswer::whereKey($assistantAnswer->id)->lockForUpdate()->firstOrFail();
                if ($answer->revision !== (int) $data['expected_revision']) return null;
                unset($data['expected_revision']);
                if (array_key_exists('category', $data) || array_key_exists('category_detail', $data)) {
                    $category = $data['category'] ?? $answer->category;
                    $detail = array_key_exists('category_detail', $data) ? $data['category_detail'] : $answer->category_detail;
                    if ($category === 'other' && blank($detail)) {
                        throw ValidationException::withMessages(['category_detail' => 'Specify the category.']);
                    }
                    if ($category !== 'other' && filled($data['category_detail'] ?? null)) {
                        throw ValidationException::withMessages(['category_detail' => 'Specify is available only for Other.']);
                    }
                    \App\Support\SelectionDetailsSchema::requireRequested(['category_detail' => $detail], ['category_detail']);
                    if (\App\Support\SelectionDetailsSchema::available()) {
                        $data['category_detail'] = $category === 'other' ? $detail : null;
                    } else {
                        unset($data['category_detail']);
                    }
                }
                $answer->fill($data);
                $changed = array_keys($answer->getDirty());
                if ($changed) {
                    $answer->revision++;
                    $answer->updated_by = $actor->id;
                    $answer->save();
                    $action = in_array('active', $changed, true) && ! $answer->active ? 'assistant.answer.deactivated' : 'assistant.answer.updated';
                    app(AuditService::class)->recordAdministrative($action, $actor, $answer, ['fields' => $changed]);
                }

                return $answer;
        });
        if (! $result) {
            return response()->json(['message' => 'This answer was changed by someone else. Reload it and try again.', 'code' => 'stale_revision'], 409);
        }

        return response()->json(['data' => $this->view($result->load('branch'))]);

        });
    }

    /** Try a question the way a Patient would ask it: which answer the assistant gives, and how sure it is. Nothing is stored. */
    public function test(Request $request): JsonResponse
    {
        $data = $request->validate(['question' => ['required', 'string', 'min:2', 'max:500'], 'history' => ['prohibited']]);
        $result = (new KnowledgeAssistant(null))->answer($data['question']);
        $entry = str_starts_with((string) ($result['topic'] ?? ''), 'faq:') ? AssistantAnswer::where('public_id', substr($result['topic'], 4))->first() : null;

        return response()->json(['data' => [
            'answer' => $result['answer'], 'outcome' => $result['outcome'], 'confidence' => $result['confidence'], 'suggestions' => $result['suggestions'],
            'source' => $entry ? 'answer' : (($result['topic'] ?? null) ? 'clinic_records' : 'none'), 'topic' => $entry ? null : ($result['topic'] ?? null),
            'entry' => $entry ? ['id' => $entry->public_id, 'question' => $entry->question, 'draft' => $entry->draft] : null,
        ]]);
    }

    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'question' => [$required, 'string', 'min:5', 'max:200'],
            'answer' => [$required, 'string', 'min:5', 'max:1000'],
            'category' => [$required, Rule::in(AssistantAnswer::CATEGORIES)],
            'category_detail' => $creating
                ? ['nullable', 'required_if:category,other', 'prohibited_unless:category,other', 'string', 'max:255']
                : ['nullable', 'string', 'max:255'],
            'keywords' => ['sometimes', 'array', 'max:40'],
            'keywords.*' => ['string', 'min:2', 'max:60', 'distinct'],
            'branch_ref' => ['sometimes', 'nullable', 'string', 'exists:branches,legacy_ref'],
            'active' => ['sometimes', 'boolean'],
            'draft' => ['sometimes', 'boolean'],
            'expected_revision' => $creating ? ['prohibited'] : ['required', 'integer', 'min:1'],
            'source' => ['sometimes', 'nullable', 'string', 'max:200'],
            'seed_key' => ['prohibited'], 'id' => ['prohibited'], 'revision' => ['prohibited'],
        ]);
        foreach (['question', 'answer', 'source'] as $text) {
            if (isset($data[$text])) $data[$text] = trim(preg_replace('/[ \t]+/', ' ', strip_tags($data[$text])));
        }
        if (isset($data['keywords'])) $data['keywords'] = array_values(array_unique(array_filter(array_map(fn ($k) => mb_strtolower(trim($k)), $data['keywords']))));
        if (array_key_exists('branch_ref', $data)) {
            $data['branch_id'] = $data['branch_ref'] ? Branch::where('legacy_ref', $data['branch_ref'])->value('id') : null;
            unset($data['branch_ref']);
        }
        if ($creating) $data += ['draft' => false, 'active' => true]; // an answer the Owner writes is confirmed unless marked draft

        return $data;
    }

    private function view(AssistantAnswer $a): array
    {
        return ['id' => $a->public_id, 'question' => $a->question, 'answer' => $a->answer, 'keywords' => $a->keywords ?? [], 'category' => $a->category, 'category_detail' => $a->category_detail,
            'branch' => $a->branch ? ['id' => $a->branch->legacy_ref, 'name' => $a->branch->name] : null, 'active' => $a->active, 'draft' => $a->draft,
            'source' => $a->source, 'revision' => $a->revision, 'updated_at' => $a->updated_at ? \App\Support\ClinicClock::local($a->updated_at)->toIso8601String() : null];
    }
}
