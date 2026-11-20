<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Services\Billing\BillingService;
use App\Services\Intake\Guardianship;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PatientHomeController extends Controller
{
    public function __invoke(Request $request, BillingService $billing): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->patient, 403);
        $patientIds = Guardianship::patientIdsFor($user);
        $dayStart = ClinicClock::now()->startOfDay();
        $upcoming = Appointment::visibleTo($user)->upcomingForPatient($dayStart)
            ->orderByRaw("CASE WHEN status IN ('Checked In', 'In Treatment') THEN 0 ELSE 1 END")
            ->orderBy('starts_at')->orderBy('id')
            ->with(['patient.person', 'branch', 'service','dentist.person'])->limit(2)->get();
        $appointment = $upcoming->first();

        $balance = Invoice::query()->whereIn('patient_id', $patientIds)->where('status', 'Issued')
            ->whereColumn('patient_responsibility_amount', '>', 'paid_amount')
            ->selectRaw('count(*) as invoice_count, coalesce(sum(patient_responsibility_amount - paid_amount), 0) as amount')
            ->firstOrFail();

        return response()->json(['data' => [
            'patient_id' => $user->patient->public_id,
            'clinic_date' => $dayStart->toDateString(),
            'more_upcoming' => $upcoming->count() > 1,
            'appointment' => $appointment ? [
                'id' => $appointment->public_id,
                'code' => $appointment->appointment_code,
                'status' => $appointment->status,
                'booking_payment_status' => $appointment->booking_payment_status,
                'starts_at' => ClinicClock::local($appointment->starts_at)->toIso8601String(),
                'dentist' => $appointment->dentist?->person?->fullName(),
                'patient' => $appointment->patient->person?->fullName(),
                'branch' => $appointment->branch->name,
                'service' => $appointment->service->name,
            ] : null,
            'balance' => [
                'count' => (int) $balance->invoice_count,
                'minor' => $billing->centavos((string) $balance->amount),
            ],
        ]])->header('Cache-Control', 'private, no-store');
    }
}
