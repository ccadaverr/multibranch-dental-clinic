<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Resources\DocumentResource;
use App\Http\Resources\PatientConsentResource;
use App\Models\CommandKey;
use App\Models\Document;
use App\Models\HmoCase;
use App\Models\Patient;
use App\Models\PatientConsent;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Document\DocumentException;
use App\Services\Document\DocumentStorageService;
use App\Support\IdempotentCommand;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

// M14 documents and consent records. Every document read/write is authorized server-side through Document::visibleTo (see
// its comment for the per-role boundary); clients never choose an owner, a storage path, a status or a timestamp. References
// are public ULIDs (Patient, Visit, HMO case, document); a branch is its legacy_ref or ULID. Consents: Patient (own) and
// Staff who may read that Patient's full profile (the M4 boundary); Dentist and Owner have no consent access until the clinic
// decides — POLICY DECISION REQUIRED.
class DocumentController extends Controller
{
    use ReadsIdempotencyKey;

    private const CLIENT_CONTROLLED_FORBIDDEN = [
        'id', 'public_id', 'file_path', 'storage_path', 'storage_key', 'checksum_sha256', 'mime_type', 'file_size_bytes', 'status',
        'uploaded_by_user_id', 'uploaded_by', 'created_by', 'verified_by', 'retracted_at', 'retracted_by_user_id', 'created_at',
        'updated_at', 'extraction', 'extractions', 'consent_status',
    ];

    public function __construct(
        private readonly DocumentStorageService $storage,
        private readonly AuditService $audit
    ) {}

    private function fail(DocumentException $e): JsonResponse
    {
        return response()->json($e->responseBody(), $e->getStatusCode());
    }

    private function isUlid(mixed $value): bool
    {
        return is_string($value) && Str::isUlid($value);
    }

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'patient_id' => ['nullable', 'string', 'max:64'],
            'visit_id' => ['nullable', 'string', 'max:64'],
            'hmo_case_id' => ['nullable', 'string', 'max:64'],
            'category' => ['nullable', 'string', 'in:'.implode(',', Document::CATEGORIES)],
            'status' => ['nullable', 'string', 'in:'.implode(',', Document::STATUSES)],
        ]);
        $q = Document::visibleTo($request->user())
            ->with(['patient.person', 'visit', 'hmoCase', 'branch', 'uploadedBy.person', 'extractions'])
            ->latest('id');

        // Public ULIDs only. A malformed or unknown reference matches nothing (never a numeric id or a patient code).
        if ($request->filled('patient_id')) {
            $patient = $this->isUlid($request->input('patient_id')) ? Patient::where('public_id', strtolower($request->input('patient_id')))->first() : null;
            $q->where('patient_id', $patient?->id ?? 0);
        }
        if ($request->filled('visit_id')) {
            $visit = $this->isUlid($request->input('visit_id')) ? Visit::where('public_id', strtolower($request->input('visit_id')))->first() : null;
            $q->where('visit_id', $visit?->id ?? 0);
        }
        if ($request->filled('hmo_case_id')) {
            $case = $this->isUlid($request->input('hmo_case_id')) ? HmoCase::where('public_id', strtolower($request->input('hmo_case_id')))->first() : null;
            $q->where('hmo_case_id', $case?->id ?? 0);
        }
        if ($request->filled('category')) {
            $q->where('category', $request->input('category'));
        }
        if ($request->filled('status')) {
            $q->where('status', $request->input('status'));
        }

        return response()->json(['data' => DocumentResource::collection($q->limit(100)->get())]);
    }

    public function mine(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->role === Role::Patient && $user->patient, 403, 'Only patients can access their personal document library.');

        $rows = Document::where('patient_id', $user->patient->id)
            ->where('status', '!=', 'Retracted')
            ->with(['patient.person', 'visit', 'hmoCase', 'branch', 'uploadedBy.person', 'extractions'])
            ->latest('id')->limit(100)->get();

        return response()->json(['data' => DocumentResource::collection($rows)]);
    }

    public function store(Request $request): JsonResponse
    {
        return \App\Support\CommandActor::run($request->user(), function ($actor) use ($request) {
            $user = $actor;
            $forbidden = array_fill_keys(self::CLIENT_CONTROLLED_FORBIDDEN, ['prohibited']);
            $request->validate($forbidden + [
                'file' => ['required', 'file', 'max:10240'], // 10MB
                // A Patient's own account decides the owner; naming one is refused rather than silently overridden.
                'patient_id' => $user->role === Role::Patient ? ['prohibited'] : ['nullable', 'string', 'max:64'],
                'visit_id' => ['nullable', 'string', 'max:64'],
                'hmo_case_id' => ['nullable', 'string', 'max:64'],
                'branch_id' => ['nullable', 'string', 'max:64'],
                'category' => ['required', 'string', 'in:'.implode(',', Document::CATEGORIES)],
                'title' => ['nullable', 'string', 'max:255'],
                'other_description' => ['nullable', 'required_if:category,other', 'prohibited_unless:category,other', 'string', 'max:255'],
                // Descriptive metadata for HMO cards only; any other key is refused.
                'metadata' => ['nullable', 'array:provider,member_number'],
                'metadata.provider' => ['nullable', 'string', 'max:100'],
                'metadata.member_number' => ['nullable', 'string', 'max:100'],
            ]);
            $attributes = $request->only(['patient_id', 'visit_id', 'hmo_case_id', 'branch_id', 'category', 'title', 'metadata']);
            if ($attributes['category'] === 'other') {
                $attributes['metadata']['other_description'] = $request->string('other_description')->trim()->toString();
            }
            $file = $request->file('file');
            $key = $this->idempotencyKey($request);

            try {
                if ($key === null) {
                    $doc = $this->storage->store($user, $file, $attributes);

                    return response()->json(['data' => (new DocumentResource($doc))->detailed()->resolve($request)], 201);
                }

                // A replay of the same upload (same key and same content/target) returns the original result; the same key with
                // different content or a different target is refused.
                $fingerprint = $attributes + ['file_sha256' => hash_file('sha256', $file->getRealPath())];

                $response = IdempotentCommand::run(CommandKey::class, $user, $key, 'document.upload', $fingerprint,
                    fn () => [['data' => (new DocumentResource($this->storage->store($user, $file, $attributes)))->detailed()->resolve($request)], 201],
                    fn () => new DocumentException(409, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different upload.'));

                if ($response->headers->get('Idempotent-Replayed') === 'true') {
                    $id = $response->getData(true)['data']['id'] ?? null;
                    abort_unless($id && Document::visibleTo($user)->where('public_id', $id)->exists(), 403);
                }

                return $response;
            } catch (DocumentException $e) {
                return $this->fail($e);
            }

        });
    }

    public function show(Request $request, Document $document): JsonResponse
    {
        abort_unless(Document::visibleTo($request->user())->whereKey($document->id)->exists(), 403);

        return response()->json([
            'data' => (new DocumentResource($document->load(['patient.person', 'visit', 'hmoCase', 'branch', 'uploadedBy.person', 'extractions'])))->detailed()->resolve($request),
        ]);
    }

    public function download(Request $request, Document $document): StreamedResponse|JsonResponse
    {
        try {
            return $this->storage->download($request->user(), $document);
        } catch (DocumentException $e) {
            return $this->fail($e);
        }
    }

    public function retract(Request $request, Document $document): JsonResponse
    {
        $request->validate(['reason' => ['required', 'string', 'max:255']]);

        try {
            return response()->json(['data' => new DocumentResource($this->storage->retract($request->user(), $document, $request->input('reason')))]);
        } catch (DocumentException $e) {
            return $this->fail($e);
        }
    }

    // ---- consent records ------------------------------------------------------------------------------------------------

    /** Patient: own. Staff: only when they may read that Patient's full profile (M4 boundary). Dentist/Owner: refused. */
    private function authorizeConsent(Request $request, Patient $patient): void
    {
        $user = $request->user();
        $allowed = match ($user->role) {
            Role::Patient => $user->patient?->id === $patient->id,
            Role::Staff => Gate::forUser($user)->allows('viewProfile', $patient),
            default => false,
        };
        abort_unless($allowed, 403, 'You are not authorized to manage this patient\'s consents.');
    }

    public function consents(Request $request, Patient $patient): JsonResponse
    {
        $this->authorizeConsent($request, $patient);
        $consents = PatientConsent::where('patient_id', $patient->id)->with(['patient', 'document', 'recordedBy.person'])->latest('id')->get();

        return response()->json(['data' => PatientConsentResource::collection($consents)]);
    }

    public function consentsMine(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->role === Role::Patient && $user->patient, 403);
        $consents = PatientConsent::where('patient_id', $user->patient->id)->with(['patient', 'document', 'recordedBy.person'])->latest('id')->get();

        return response()->json(['data' => PatientConsentResource::collection($consents)]);
    }

    public function grantConsent(Request $request, Patient $patient): JsonResponse
    {
        $this->authorizeConsent($request, $patient);
        $user = $request->user();

        $v = $request->validate([
            'consent_type' => ['required', 'string', 'in:'.implode(',', PatientConsent::TYPES)],
            'version' => ['nullable', 'string', 'max:32'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'document_id' => ['nullable', 'string', 'max:64'],
            'id' => ['prohibited'], 'public_id' => ['prohibited'], 'patient_id' => ['prohibited'], 'status' => ['prohibited'],
            'signed_at' => ['prohibited'], 'withdrawn_at' => ['prohibited'], 'recorded_by_user_id' => ['prohibited'], 'recorded_by' => ['prohibited'],
        ]);

        $document = null;
        if (! empty($v['document_id'])) {
            $document = $this->isUlid($v['document_id']) ? Document::where('public_id', strtolower($v['document_id']))->first() : null;
            if (! $document || $document->patient_id !== $patient->id || $document->status === 'Retracted') {
                abort(422, 'The supporting document must be an active document of this patient.');
            }
        }
        $version = $v['version'] ?? '1.0';

        try {
            $consent = DB::transaction(function () use ($patient, $v, $version, $document, $user) {
            Patient::whereKey($patient->id)->lockForUpdate()->firstOrFail();
            if (PatientConsent::where('patient_id', $patient->id)->where('consent_type', $v['consent_type'])->where('version', $version)->where('status', 'Granted')->exists()) {
                throw new DocumentException(409, 'consent_already_granted', 'This consent is already on file. Withdraw it before recording it again.');
            }
            $consent = PatientConsent::create([
                'patient_id' => $patient->id, 'document_id' => $document?->id, 'consent_type' => $v['consent_type'], 'version' => $version,
                'status' => 'Granted', 'notes' => $v['notes'] ?? null, 'signed_at' => CarbonImmutable::now('Asia/Manila'), 'recorded_by_user_id' => $user->id,
            ]);
            $this->audit->record([
                'action' => 'consent.granted', 'category' => 'clinical', 'severity' => 'info', 'actor' => $user, 'target' => $consent,
                'payload' => ['consent_type' => $consent->consent_type, 'version' => $consent->version, 'patient_code' => $patient->patient_code, 'document_linked' => $document !== null],
            ]);

            return $consent;
            });
        } catch (DocumentException $e) {
            return $this->fail($e);
        }

        return response()->json(['data' => new PatientConsentResource($consent->load(['patient', 'document', 'recordedBy.person']))], 201);
    }

    public function withdrawConsent(Request $request, Patient $patient, PatientConsent $consent): JsonResponse
    {
        $this->authorizeConsent($request, $patient);
        abort_if($consent->patient_id !== $patient->id, 404);

        $result = DB::transaction(function () use ($consent, $patient, $request) {
            $locked = PatientConsent::whereKey($consent->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === 'Withdrawn') {
                return null;
            }
            $locked->update(['status' => 'Withdrawn', 'withdrawn_at' => CarbonImmutable::now('Asia/Manila')]);
            $this->audit->record([
                'action' => 'consent.withdrawn', 'category' => 'clinical', 'severity' => 'warning', 'actor' => $request->user(), 'target' => $locked,
                'payload' => ['consent_type' => $locked->consent_type, 'version' => $locked->version, 'patient_code' => $patient->patient_code],
            ]);

            return $locked;
        });
        if ($result === null) {
            return response()->json(['message' => 'Consent already withdrawn.', 'code' => 'already_withdrawn'], 422);
        }

        return response()->json(['data' => new PatientConsentResource($result->fresh(['patient', 'document', 'recordedBy.person']))]);
    }
}
