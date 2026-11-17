<?php

namespace App\Http\Resources;

use App\Enums\Role;
use Illuminate\Http\Resources\Json\JsonResource;

// Minimal document projection. Never exposes the storage path or key, internal ids, or (in list responses) any extracted
// text. Ids are public ULIDs; the branch uses its transitional legacy_ref. `detailed()` adds the extraction text/candidates
// for the single-document response only.
class DocumentResource extends JsonResource
{
    private bool $detail = false;

    public function detailed(): static
    {
        $this->detail = true;

        return $this;
    }

    public function toArray($request): array
    {
        $d = $this->resource;
        $viewer = $request->user();
        $patientViewer = $viewer?->role === Role::Patient;
        $extractions = $d->relationLoaded('extractions') ? $d->extractions : collect();

        return [
            'id' => $d->public_id,
            'category' => $d->category,
            'other_description' => $d->category === 'other' ? ($d->metadata['other_description'] ?? null) : null,
            'title' => $d->title,
            'original_filename' => $d->original_filename,
            'mime_type' => $d->mime_type,
            'file_size_bytes' => (int) $d->file_size_bytes,
            'checksum_sha256' => $d->checksum_sha256,
            'status' => $d->status,
            'metadata' => $d->metadata,
            'patient' => $d->patient ? [
                'id' => $d->patient->public_id,
                'code' => $d->patient->patient_code,
                'name' => $d->patient->person?->fullName(),
            ] : null,
            'visit_id' => $d->visit?->public_id,
            'hmo_case_id' => $d->hmoCase?->public_id,
            'branch' => $d->branch ? ['id' => $d->branch->legacy_ref, 'name' => $d->branch->name] : null,
            // A Patient sees only who kind of account added a document, never a staff member's name.
            'uploaded_by' => $d->uploadedBy ? ($patientViewer
                ? ['role' => $d->uploadedBy->role?->value]
                : ['id' => $d->uploadedBy->public_id, 'name' => $d->uploadedBy->person?->fullName() ?? $d->uploadedBy->name, 'role' => $d->uploadedBy->role?->value]) : null,
            'retracted_at' => $d->retracted_at?->toIso8601String(),
            'retraction_reason' => $d->retraction_reason,
            // Honest capability flags: text extraction is native-PDF only (no OCR), and no malware scanner exists.
            'text_extraction' => $extractions->isNotEmpty() ? 'draft_available' : ($d->mime_type === 'application/pdf' ? 'no_text_layer' : 'unavailable_ocr_not_configured'),
            'security_scan' => 'not_performed',
            'extractions' => $extractions->map(fn ($e) => (new DocumentExtractionResource($e))->additional(['detail' => $this->detail])->resolve($request))->values(),
            'created_at' => $d->created_at?->toIso8601String(),
            'updated_at' => $d->updated_at?->toIso8601String(),
        ];
    }
}
