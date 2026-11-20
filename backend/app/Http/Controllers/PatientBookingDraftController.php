<?php

namespace App\Http\Controllers;

use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PatientBookingDraftController extends Controller
{
    public function handle(Request $request)
    {
        $patient = $request->user()->patient;
        abort_unless($patient, 403);
        $write = $request->isMethod('put');
        $data = $write ? $request->validate([
            'revision' => ['required', 'integer', 'min:0'],
            'selection' => ['present', 'nullable', 'array:service_ref,intended_service_ref,branch_ref,date,start_time,step,payment'],
            'selection.service_ref' => ['required_with:selection', 'string', 'exists:services,legacy_ref'],
            'selection.intended_service_ref' => ['nullable', 'string', 'exists:services,legacy_ref'],
            'selection.branch_ref' => ['nullable', 'string', 'exists:branches,legacy_ref'],
            'selection.date' => ['nullable', 'date_format:Y-m-d'],
            'selection.start_time' => ['nullable', 'date_format:H:i'],
            'selection.step' => ['required_with:selection', 'integer', 'between:0,3'],
            'selection.payment' => ['required_with:selection', Rule::in(['cash','online'])],
        ]) : [];

        return DB::transaction(function () use ($patient, $write, $data) {
            // Also serialize first writes when no draft row exists yet.
            DB::table('patients')->where('id', $patient->id)->lockForUpdate()->firstOrFail();
            $query = DB::table('patient_booking_drafts')->where('patient_id', $patient->id);
            $now = ClinicClock::now();
            $row = $query->lockForUpdate()->first();
            $revision = (int) ($row->revision ?? 0);
            $selection = json_decode($row->selection ?? 'null', true);
            $settled = isset($selection['held_appointment']) && DB::table('appointments')->where('public_id', $selection['held_appointment'])
                ->where('patient_id', $patient->id)->where('booking_payment_status', 'paid')->exists();
            if ($settled || ($row?->expires_at && $now->gte($row->expires_at))) {
                $query->update(['revision' => ++$revision, 'selection' => null, 'expires_at' => null, 'updated_at' => $now]);
                $row = $query->first();
            }
            if ($write && (int) $data['revision'] !== $revision) {
                return response()->json(['message' => 'This draft changed or expired. Reload to review the current draft.'], 409);
            }
            if ($write) {
                $selection = $data['selection'];
                DB::table('patient_booking_drafts')->updateOrInsert(['patient_id' => $patient->id], [
                    'selection' => $selection ? json_encode($selection, JSON_THROW_ON_ERROR) : null,
                    'revision' => ++$revision, 'expires_at' => $selection ? $now->addDays(7)->toIso8601String() : null,
                    'updated_at' => $now->toIso8601String(),
                ]);
                $row = $query->first();
            }
            return response()->json(['data' => ['revision' => $revision, 'selection' => json_decode($row->selection ?? 'null', true),
                'updated_at' => $row->updated_at ?? null]])->header('Cache-Control', 'private, no-store');
        });
    }
}
