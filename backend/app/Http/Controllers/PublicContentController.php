<?php

namespace App\Http\Controllers;

use App\Models\AssistantAnswer;
use App\Models\Service;
use App\Support\DevelopmentClinicCatalog;
use Illuminate\Http\JsonResponse;

/**
 * Public website content (no sign-in), read from the clinic's own records so nothing is hard-coded in the frontend:
 *   GET /api/public/services — active services, with explicitly provisional estimates on development environments.
 *   GET /api/public/faq      — the assistant answers the clinic has CONFIRMED (active, not draft). Drafts never appear here.
 */
class PublicContentController extends Controller
{
    public function services(): JsonResponse
    {
        // F7: services hidden online are not listed; consultation-first ones say so (R2-17).
        return response()->json(['data' => Service::where('status', 'Active')->where('online_booking', '<>', 'hidden')
            ->when(! app()->environment(['local', 'testing']), fn ($query) => $query->whereNotIn('legacy_ref', array_keys(DevelopmentClinicCatalog::SERVICES)))
            ->where('legacy_ref', '<>', DevelopmentClinicCatalog::INTERNAL_CONSULTATION)->orderBy('category')->orderBy('name')->get()->map(fn (Service $s) => [
            'id' => $s->legacy_ref, 'name' => $s->name, 'category' => $s->category, 'description' => $s->description,
            'duration_minutes' => DevelopmentClinicCatalog::isCatalogService($s) ? null : $s->duration_minutes,
            'starts_with_consultation' => $s->online_booking === 'consultation_first',
            'price' => DevelopmentClinicCatalog::presentation($s),
        ])->values()]);
    }

    public function faq(): JsonResponse
    {
        return response()->json(['data' => AssistantAnswer::where('active', true)->where('draft', false)->whereNull('branch_id')->orderBy('category')->orderBy('question')->get()
            ->map(fn (AssistantAnswer $a) => ['id' => $a->public_id, 'question' => $a->question, 'answer' => $a->answer, 'category' => $a->category])->values(),
            // F8: only HMOs the clinic verified; F4: the cancellation policy as the Owner set it.
            'meta' => ['accepted_hmos' => \App\Http\Controllers\AcceptedHmoController::publicList(), 'cancellation_policy' => \App\Services\Automations\AttendancePolicy::summary()]]);
    }
}
