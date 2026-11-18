<?php

namespace App\Services\Document;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\Document;
use App\Models\HmoCase;
use App\Models\Patient;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

// M14 secure document storage. Files live on the private `local` disk (never served by a framework route) under a
// server-generated name; the database row is the only way to reach one, and every read/write is authorized against
// Document::visibleTo and the upload rules below. The upload is validated against the file's CONTENT, not its name or the
// browser-supplied Content-Type. No malware scanner exists in this system: a stored file is "type-checked", never "safe".
class DocumentStorageService
{
    /** Detected content type => storage extension. The narrowest set currently justified; widening it is a clinic decision. */
    public const TYPES = [
        'application/pdf' => 'pdf',
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    public const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

    public const MAX_BYTES = 10485760; // 10MB

    public function __construct(private readonly TextExtractionService $extractor, private readonly AuditService $audit) {}

    public function uploadTarget(User $actor, array $attributes): array
    {
        if ($actor->role === Role::Staff && ! UserBranchScope::where('user_id', $actor->id)->exists()) {
            throw new DocumentException(403, 'forbidden', 'Staff without an authorization branch scope cannot upload documents.');
        }
        if ($actor->role === Role::Staff && empty($attributes['branch_id']) && empty($attributes['visit_id']) && empty($attributes['hmo_case_id'])) {
            throw new DocumentException(422, 'branch_required', 'Choose the branch (or the visit) this document belongs to.');
        }
        if ($actor->role === Role::Dentist && empty($attributes['visit_id'])) {
            throw new DocumentException(403, 'forbidden', 'A Dentist may add a document only to a visit they are responsible for.');
        }
        $branch = ! empty($attributes['branch_id']) ? $this->resolveBranch($actor, $attributes['branch_id']) : null;
        $patient = $this->resolvePatient($actor, $attributes['patient_id'] ?? null);
        $visit = ! empty($attributes['visit_id']) ? $this->resolveVisit($actor, $attributes['visit_id'], $patient) : null;
        $hmoCase = ! empty($attributes['hmo_case_id']) ? $this->resolveHmoCase($actor, $attributes['hmo_case_id'], $patient) : null;
        $branch ??= $visit?->branch ?? $hmoCase?->branch;
        if (($visit && $visit->branch_id !== $branch?->id) || ($hmoCase && $hmoCase->branch_id !== $branch?->id)
            || ($visit && $hmoCase && $hmoCase->visit_id !== $visit->id)) {
            throw new DocumentException(422, 'document_context_mismatch', 'The document records must belong to the same branch and visit.');
        }
        $this->authorizeUpload($actor, $patient, $visit, $branch);


        return [$patient, $visit, $hmoCase, $branch];
    }

    public function store(User $actor, UploadedFile $file, array $attributes, array $target): Document
    {
        [$patient, $visit, $hmoCase, $branch] = $target;
        $mime = $this->validateFile($file);
        $category = $attributes['category'] ?? 'other';
        if (! in_array($category, Document::CATEGORIES, true)) {
            throw new DocumentException(422, 'invalid_document_category', "Category '{$category}' is not supported.", ['allowed' => Document::CATEGORIES]);
        }

        $originalName = $this->safeFilename($file->getClientOriginalName());
        $title = trim((string) ($attributes['title'] ?? ''));
        $title = $title !== '' ? $title : ($originalName !== 'document' ? $originalName : 'Document '.CarbonImmutable::now('Asia/Manila')->format('Y-m-d H:i'));

        $folder = 'documents/'.$patient->public_id;
        $filename = strtolower((string) Str::ulid()).'.'.self::TYPES[$mime]; // extension from the detected type, never the client's
        $storagePath = $folder.'/'.$filename;
        $sha256 = hash_file('sha256', $file->getRealPath());
        $size = $file->getSize();
        $disk = Storage::disk('local');

        $written = false;
        try {
            $stored = $disk->putFileAs($folder, $file, $filename);
            if (! $stored) {
                throw new DocumentException(500, 'storage_write_failed', 'The document could not be stored.');
            }
            $written = true;

            return DB::transaction(function () use ($actor, $patient, $visit, $hmoCase, $branch, $category, $title, $originalName, $mime, $size, $storagePath, $sha256, $attributes) {
                $doc = Document::create([
                    'patient_id' => $patient->id,
                    'visit_id' => $visit?->id,
                    'hmo_case_id' => $hmoCase?->id,
                    'branch_id' => $branch?->id,
                    'category' => $category,
                    'title' => $title,
                    'file_path' => $storagePath,
                    'original_filename' => $originalName,
                    'mime_type' => $mime,
                    'file_size_bytes' => $size,
                    'checksum_sha256' => $sha256,
                    'status' => 'Active',
                    'metadata' => $attributes['metadata'] ?? null,
                    'uploaded_by_user_id' => $actor->id,
                ]);

                $extraction = $this->extractor->extract($doc);

                // Inside the transaction: if the audit write fails the upload rolls back (and the file is removed below).
                $this->audit->record([
                    'action' => 'document.uploaded', 'category' => 'administrative', 'severity' => 'info',
                    'actor' => $actor, 'target' => $doc, 'branch_id' => $doc->branch_id,
                    // Minimal metadata: no title, filename, extracted text or contents.
                    'payload' => ['category' => $doc->category, 'mime_type' => $doc->mime_type, 'file_size_bytes' => $doc->file_size_bytes,
                        'checksum_sha256' => $doc->checksum_sha256, 'extraction' => $extraction ? 'draft_created' : 'none'],
                ]);

                return $doc->fresh(['patient.person', 'visit', 'hmoCase', 'branch', 'uploadedBy.person', 'extractions']);
            });
        } catch (Throwable $e) {
            // Database/audit failure after the file was written: do not leave an uncontrolled orphan behind.
            if ($written) {
                try {
                    $disk->delete($storagePath);
                } catch (Throwable) {
                    // best effort; the object is unreferenced and unreachable without a row
                }
            }
            throw $e;
        }
    }

    public function download(User $actor, Document $document): StreamedResponse
    {
        if (! Document::visibleTo($actor)->whereKey($document->id)->exists()) {
            throw new DocumentException(403, 'forbidden', 'You are not authorized to view or download this document.');
        }
        if ($document->status === 'Retracted') {
            throw new DocumentException(410, 'document_retracted', 'This document was retracted and is no longer accessible.');
        }

        $disk = Storage::disk('local');
        if (! $disk->exists($document->file_path)) {
            throw new DocumentException(404, 'file_not_found', 'The stored file for this document is missing. Contact the clinic.');
        }
        if ((int) $disk->size($document->file_path) !== (int) $document->file_size_bytes) {
            throw new DocumentException(409, 'storage_mismatch', 'The stored file does not match its record. Contact the clinic.');
        }

        $safeName = $this->safeFilename($document->original_filename ?: 'document');

        return response()->stream(function () use ($disk, $document) {
            $stream = $disk->readStream($document->file_path);
            if (is_resource($stream)) {
                fpassthru($stream);
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $document->mime_type,
            'Content-Length' => (string) $document->file_size_bytes,
            'Content-Disposition' => 'inline; filename="'.$safeName.'"',
            'X-Content-Type-Options' => 'nosniff',
            // Defence in depth for an inline PDF/image: no active content may run from this response.
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cache-Control' => 'private, no-cache, no-store, must-revalidate',
        ]);
    }

    public function retract(User $actor, Document $document, string $reason): Document
    {
        if (! Document::visibleTo($actor)->whereKey($document->id)->exists()) {
            throw new DocumentException(403, 'forbidden', 'You are not authorized to act on this document.');
        }
        // Retraction is a soft, audited status change (the file and row are kept). Patients and Dentists may retract only what
        // they uploaded themselves; Staff may retract a document in their scope; Owner has no document access.
        if (in_array($actor->role, [Role::Patient, Role::Dentist], true) && $document->uploaded_by_user_id !== $actor->id) {
            throw new DocumentException(403, 'forbidden', 'You may only retract documents you uploaded yourself.');
        }
        if ($document->status === 'Retracted') {
            throw new DocumentException(422, 'already_retracted', 'This document has already been retracted.');
        }
        $reason = trim($reason);
        if ($reason === '') {
            throw new DocumentException(422, 'reason_required', 'A reason is required to retract a document.');
        }

        return DB::transaction(function () use ($actor, $document, $reason) {
            $document->update([
                'status' => 'Retracted',
                'retracted_at' => CarbonImmutable::now('Asia/Manila'),
                'retracted_by_user_id' => $actor->id,
                'retraction_reason' => substr($reason, 0, 255),
            ]);
            // The free-text reason stays on the document row; the audit payload records only that one was given.
            $this->audit->record([
                'action' => 'document.retracted', 'category' => 'administrative', 'severity' => 'warning',
                'actor' => $actor, 'target' => $document, 'branch_id' => $document->branch_id, 'payload' => ['reason_recorded' => true],
            ]);

            return $document->fresh(['patient.person', 'visit', 'hmoCase', 'branch', 'uploadedBy.person', 'retractedBy', 'extractions']);
        });
    }

    /**
     * Validates the CONTENT: size, then the file's real signature (never the extension or the browser's Content-Type), then
     * that the server-detected type agrees with it. Returns the detected MIME type.
     */
    private function validateFile(UploadedFile $file): string
    {
        if (! $file->isValid()) {
            throw new DocumentException(422, 'invalid_upload', 'The uploaded file was corrupted or incomplete.');
        }
        $size = $file->getSize();
        if ($size <= 0) {
            throw new DocumentException(422, 'empty_file', 'The file is empty.', ['size_bytes' => (int) $size]);
        }
        if ($size > self::MAX_BYTES) {
            throw new DocumentException(422, 'file_too_large', 'Document size must be at most 10MB.', ['size_bytes' => $size, 'max_bytes' => self::MAX_BYTES]);
        }

        $signature = $this->signatureType((string) file_get_contents($file->getRealPath(), false, null, 0, 16));
        $reported = $file->getMimeType();
        if ($signature === null || $reported !== $signature) {
            $shown = $signature ?? ($reported ?: 'unknown');
            throw new DocumentException(422, 'disallowed_mime_type', "This file's content ('{$shown}') is not a permitted type. Only PDF and JPG/PNG/WebP images are allowed.", ['allowed_mimes' => self::ALLOWED_MIMES]);
        }

        return $signature;
    }

    /** The content type implied by the leading bytes, or null for anything else (scripts, executables, archives, ...). */
    private function signatureType(string $head): ?string
    {
        return match (true) {
            str_starts_with($head, '%PDF-') => 'application/pdf',
            str_starts_with($head, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($head, "\x89PNG\r\n\x1A\n") => 'image/png',
            str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP' => 'image/webp',
            default => null,
        };
    }

    /** Client filename -> display metadata only (never a path): no separators, control characters or leading dots. */
    private function safeFilename(?string $name): string
    {
        $name = basename(str_replace('\\', '/', (string) $name));
        $name = (string) preg_replace('/[\x00-\x1F\x7F]+/u', '', $name);
        $name = (string) preg_replace('/[^\p{L}\p{N} ._()\-]+/u', '_', $name);
        $name = ltrim(trim($name), '.');

        return $name === '' ? 'document' : mb_substr($name, 0, 150);
    }

    private function resolvePatient(User $actor, ?string $patientId): Patient
    {
        if ($actor->role === Role::Patient) {
            return $actor->patient ?? throw new DocumentException(403, 'forbidden', 'Patient profile not found for authenticated user.');
        }
        if (empty($patientId)) {
            throw new DocumentException(422, 'patient_required', 'patient_id is required.');
        }
        // M4 identity contract: a Patient is named by public_id only (never patient_code or the bigint id).
        $patient = Str::isUlid($patientId) ? Patient::where('public_id', strtolower($patientId))
            ->when($actor->role === Role::Dentist, fn ($q) => $q->whereIn('id', Visit::visibleTo($actor)->select('patient_id')))
            ->first() : null;

        return $patient ?? throw new DocumentException(404, 'patient_not_found', 'Specified patient does not exist.');
    }

    private function resolveVisit(User $actor, string $visitId, Patient $patient): Visit
    {
        // The Visit's stable contract is its ULID public_id (VisitResource); numeric ids are never accepted.
        $visit = Str::isUlid($visitId) ? Visit::where('public_id', strtolower($visitId))->first() : null;
        if (! $visit) {
            throw new DocumentException(404, 'visit_not_found', 'Specified visit does not exist.');
        }
        if (($actor->role === Role::Patient && $visit->patient_id !== $patient->id)
            || ($actor->role !== Role::Patient && ! Visit::visibleTo($actor)->whereKey($visit->id)->exists())) {
            throw new DocumentException(404, 'visit_not_found', 'Specified visit does not exist.');
        }
        if ($visit->patient_id !== $patient->id) {
            throw new DocumentException(422, 'visit_patient_mismatch', 'The visit does not belong to the specified patient.');
        }

        return $visit;
    }

    private function resolveHmoCase(User $actor, string $caseId, Patient $patient): HmoCase
    {
        $case = Str::isUlid($caseId) ? HmoCase::where('public_id', strtolower($caseId))->first() : null;
        if (! $case || ($actor->role === Role::Patient ? $case->patient_id !== $patient->id : ! HmoCase::visibleTo($actor)->whereKey($case->id)->exists())) {
            throw new DocumentException(404, 'hmo_case_not_found', 'Specified HMO case does not exist.');
        }
        if ($case->patient_id !== $patient->id) {
            throw new DocumentException(422, 'hmo_patient_mismatch', 'The HMO case does not belong to the specified patient.');
        }

        return $case;
    }

    private function resolveBranch(User $actor, string $branchRef): Branch
    {
        // M2 contract: the legacy_ref or the ULID public_id — never the bigint id.
        $branch = Branch::where('legacy_ref', $branchRef)->orWhereRaw('lower(public_id) = ?', [strtolower($branchRef)])->first();
        if (! $branch) {
            throw new DocumentException(404, 'branch_not_found', 'Specified branch does not exist.');
        }
        if ($actor->role === Role::Staff && ! UserBranchScope::where('user_id', $actor->id)->where('branch_id', $branch->id)->exists()) {
            throw new DocumentException(403, 'forbidden', 'Staff user cannot upload documents outside their branch scope.');
        }

        return $branch;
    }

    /** Who may add a document to which Patient. Owner has no document access; see Document::scopeVisibleTo. */
    private function authorizeUpload(User $actor, Patient $patient, ?Visit $visit, ?Branch $branch): void
    {
        switch ($actor->role) {
            case Role::Patient:
                return;
            case Role::Staff:
                if (! $branch) {
                    throw new DocumentException(422, 'branch_required', 'Choose the branch (or the visit) this document belongs to.');
                }

                if (! $visit && ! Appointment::visibleTo($actor)->where('patient_id', $patient->id)->where('branch_id', $branch->id)->exists()
                    && ! Visit::visibleTo($actor)->where('patient_id', $patient->id)->where('branch_id', $branch->id)->exists()) {
                    throw new DocumentException(404, 'patient_not_found', 'Specified patient does not exist.');
                }

                return;
            case Role::Dentist:
                return;
            default:
                throw new DocumentException(403, 'forbidden', 'You are not authorized to upload documents.');
        }
    }
}
