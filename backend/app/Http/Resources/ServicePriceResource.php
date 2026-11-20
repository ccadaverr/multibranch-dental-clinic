<?php

namespace App\Http\Resources;

use App\Support\ClinicClock;
use App\Support\DevelopmentClinicCatalog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Owner-facing price version (history). `id` is the ULID public_id; Service and branch use their legacy_ref ids.
// `amount` is a decimal string ("1500.00") or null for an `ended` version. No internal ids are exposed.
class ServicePriceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $iso = fn ($value) => $value ? ClinicClock::local($value)->toIso8601String() : null;

        return [
            'id' => $this->public_id,
            'service' => ['id' => $this->service->legacy_ref, 'code' => $this->service->code, 'name' => $this->service->name],
            'branch' => $this->branch ? ['id' => $this->branch->legacy_ref, 'name' => $this->branch->name] : null,
            'level' => $this->branch_id === null ? 'base' : 'branch',
            'kind' => $this->kind,
            'amount' => $this->amount !== null ? (string) $this->amount : null,
            'effective_from' => $this->effective_from->format('Y-m-d'),
            'source' => $this->source,
            'development_sample' => app()->environment('local')
                && DevelopmentClinicCatalog::isCatalogService($this->service),
            'created_at' => $iso($this->created_at),
            'created_by' => ['name' => $this->createdBy?->person?->fullName()],
            'retracted_at' => $iso($this->retracted_at),
            'retracted_by' => $this->retracted_at ? ['name' => $this->retractedBy?->person?->fullName()] : null,
        ];
    }
}
