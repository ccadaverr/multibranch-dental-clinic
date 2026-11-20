<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\BranchService;
use App\Support\DevelopmentClinicCatalog;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/public/branches — the clinic's open branches for the public website (no sign-in): name, address, the approximate map
 * coordinates, phone, email (when the clinic gave one) and opening hours per weekday. The website keeps no branch list of its
 * own, so the Owner's changes appear everywhere at once.
 */
class PublicBranchController extends Controller
{
    public function index(): JsonResponse
    {
        $branches = Branch::where('status', 'Open')->whereNull('archived_at')->orderBy('legacy_ref')->get()->values();
        $services = BranchService::with('service')->whereIn('branch_id', $branches->modelKeys())->where('active', true)->get()->groupBy('branch_id');

        return response()->json(['data' => $branches->map(fn (Branch $b, int $i) => [
            'id' => $b->legacy_ref, 'number' => sprintf('%02d', $i + 1), 'name' => $b->name, 'address' => $b->address, 'city' => $b->city,
            'latitude' => $b->latitude !== null ? (float) $b->latitude : null, 'longitude' => $b->longitude !== null ? (float) $b->longitude : null,
            'phone' => $b->phone ?: null, 'email' => $b->email ?: null, 'weekly_hours' => $b->weekHours(),
            'services' => ($services->get($b->id) ?? collect())->pluck('service')
                ->filter(fn ($s) => $s && $s->status === 'Active' && $s->online_booking !== 'hidden'
                    && $s->legacy_ref !== DevelopmentClinicCatalog::INTERNAL_CONSULTATION
                    && (! DevelopmentClinicCatalog::isCatalogService($s) || app()->environment('local')))
                ->map(fn ($s) => ['id' => $s->legacy_ref, 'name' => $s->name])->values(),
            'development_catalog' => app()->environment('local') && isset(DevelopmentClinicCatalog::BRANCHES[$b->legacy_ref])
                && ($services->get($b->id) ?? collect())->contains(fn ($link) => $link->service && DevelopmentClinicCatalog::isCatalogService($link->service)),
        ])->all()]);
    }
}
