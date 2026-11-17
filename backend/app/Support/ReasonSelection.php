<?php

namespace App\Support;

use Illuminate\Validation\Rule;

final class ReasonSelection
{
    public const FOLLOWUP = ['Post-Op Check', 'Suture Removal', 'Crown / Bridge Fitting', 'Restoration Polish', 'Ortho Adjustment', 'Routine Cleaning / Recall', 'Other'];

    public const PATIENT_CANCELLATION = ['Schedule conflict', 'No longer need the appointment', 'Feeling unwell',
        'Booked the wrong date, time, branch, or service', 'Found another appointment', 'Other'];

    public const STAFF_CANCELLATION = ['No valid ID presented', 'Patient requested cancellation', 'Patient unable to proceed',
        'Emergency / personal conflict', 'Other'];

    public static function rules(string $category, string $detail, array $options, int $max): array
    {
        return [
            $category => ['nullable', 'string', Rule::in($options)],
            $detail => ['nullable', "required_if:{$category},Other", "prohibited_unless:{$category},Other", 'string', "max:{$max}"],
        ];
    }

    public static function text(array $data, string $category, string $detail, string $legacy): ?string
    {
        $choice = $data[$category] ?? null;

        return $choice === 'Other' ? $data[$detail] : ($choice ?? $data[$legacy] ?? null);
    }
}
