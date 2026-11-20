<?php

namespace App\Support;

use App\Models\Service;

final class DevelopmentClinicCatalog
{
    // Owner-supplied contact details. Coordinates are from the matching place records in docs/BRANCH_LOCATIONS.md.
    public const BRANCHES = [
        'b1' => ['Dr. Dana Roxas Dental Clinic', '#37 MacArthur Hwy, Bocaue, 3018 Bulacan, Philippines', '09228787341', 'Bocaue', '14.8002540', '120.9233274'],
        'b2' => ['Roxas - Cardinal Dental Center', '67 MacArthur Hwy, Wakas, Bocaue, 3018 Bulacan, Philippines', '09569031135', 'Bocaue', '14.7996762', '120.9234564'],
        'b3' => ['Roxas Dental Clinic Guiguinto', 'Unit 20 GD Plaza, Guiguinto, Bulacan, Philippines', '09569031135', 'Guiguinto', '14.8284409', '120.8745988'],
    ];

    // [name, category, display estimate in centavos, unit, first consultation ref, description]
    // This data is illustrative. M13 price versions remain the only live billing authority.
    public const SERVICES = [
        'dental-consultation' => ['Dental Consultation', 'Assessment', 50000, null, null, 'Discuss your concerns and have an initial dental assessment.'],
        'oral-examination' => ['Oral Examination', 'Assessment', 50000, null, null, 'An exam to review your teeth, gums and oral health. An examination included in a consultation is not a second booking.'],
        'cleaning' => ['Oral Prophylaxis / Cleaning', 'Prevention', 100000, null, null, 'Routine removal of plaque and tartar.'],
        'fluoride' => ['Fluoride Treatment', 'Prevention', 80000, null, null, 'A preventive fluoride application when appropriate.'],
        'sealants' => ['Dental Sealants', 'Prevention', 90000, 'tooth', 'dental-consultation', 'Assessment for protective coating on tooth grooves.'],
        'filling' => ['Tooth Filling', 'Restorative dentistry', 150000, 'tooth', 'dental-consultation', 'Assess a cavity or damaged tooth before restoration.'],
        'bonding' => ['Composite Bonding', 'Restorative dentistry', 250000, 'tooth', 'dental-consultation', 'Review tooth shape or damage and discuss composite repair.'],
        'crowns' => ['Dental Crowns', 'Prosthodontics', 800000, 'tooth', 'dental-consultation', 'Assess whether a protective tooth covering is appropriate.'],
        'bridges' => ['Dental Bridges', 'Prosthodontics', 1800000, '', 'dental-consultation', 'Discuss whether a fixed replacement suits a missing tooth.'],
        'inlays-onlays' => ['Inlays and Onlays', 'Restorative dentistry', 600000, 'tooth', 'dental-consultation', 'Assess a tooth for a partial restoration.'],
        'root-canal' => ['Root Canal Treatment', 'Endodontics', 750000, 'tooth', 'dental-consultation', 'Assess symptoms and discuss options for treating the inside of a tooth.'],
        'deep-cleaning' => ['Deep Cleaning / Scaling and Root Planing', 'Periodontics', 250000, 'quadrant', 'dental-consultation', 'Assess the gums and discuss cleaning below the gumline.'],
        'gum-treatment' => ['Periodontal / Gum Treatment', 'Periodontics', 300000, '', 'dental-consultation', 'Review gum concerns and possible treatment.'],
        'simple-extraction' => ['Simple Tooth Extraction', 'Oral surgery', 120000, 'tooth', 'dental-consultation', 'Assess whether removal is appropriate and discuss alternatives.'],
        'surgical-extraction' => ['Surgical Extraction', 'Oral surgery', 500000, '', 'dental-consultation', 'Review the need for surgical removal and discuss the next steps.'],
        'wisdom-tooth' => ['Impacted Wisdom Tooth Removal', 'Oral surgery', 900000, '', 'dental-consultation', 'Assess an impacted wisdom tooth before planning any procedure.'],
        'orthodontic-consultation' => ['Orthodontic Consultation', 'Orthodontics', 60000, null, null, 'Review tooth alignment and discuss possible treatment.'],
        'braces' => ['Dental Braces', 'Orthodontics', 3500000, '', 'orthodontic-consultation', 'Begin with an orthodontic assessment and treatment discussion.'],
        'braces-adjustment' => ['Braces Adjustment', 'Orthodontics', 100000, 'fixed:visit', 'orthodontic-consultation', 'Existing orthodontic patients can ask the clinic to verify their treatment and arrange an adjustment.'],
        'retainers' => ['Dental Retainers', 'Orthodontics', 400000, 'arch', 'orthodontic-consultation', 'Review the fit or need for a retainer.'],
        'whitening' => ['Teeth Whitening', 'Cosmetic dentistry', 500000, '', 'dental-consultation', 'Discuss suitability and options for tooth whitening.'],
        'veneers' => ['Dental Veneers', 'Cosmetic dentistry', 900000, 'tooth', 'dental-consultation', 'Assess whether veneers are appropriate and discuss materials.'],
        'complete-dentures' => ['Complete Dentures', 'Prosthodontics', 1500000, 'arch', 'prosthodontic-consultation', 'Complete dentures begin with a consultation to assess your needs and discuss treatment options.'],
        'partial-dentures' => ['Partial Dentures', 'Prosthodontics', 600000, 'arch', 'prosthodontic-consultation', 'Assess the remaining teeth and discuss partial denture options.'],
        'denture-repair' => ['Denture Repair', 'Prosthodontics', 150000, '', 'prosthodontic-consultation', 'Have the denture inspected to determine whether it can be repaired.'],
        'pediatric-consultation' => ['Pediatric Dental Consultation', 'Pediatric dentistry', 50000, null, null, 'Discuss a child’s dental needs with their parent or guardian.'],
        'child-prevention' => ["Children’s Preventive Care", 'Pediatric dentistry', 90000, null, null, 'A preventive visit for a child, subject to clinical assessment.'],
        'implant-consultation' => ['Dental Implant Consultation', 'Implant dentistry', 70000, null, null, 'Discuss implant suitability and possible assessment needs.'],
        'xray' => ['Dental X-ray', 'Diagnostics', 70000, 'image', 'dental-consultation', 'The clinic can arrange imaging after verifying a referral or order. Without one, start with a consultation.'],
        'emergency-assessment' => ['Emergency Dental Assessment', 'Assessment', 70000, null, null, 'Request assessment of an urgent dental concern. Contact the clinic directly for help arranging priority care.'],
    ];

    public const INTERNAL_CONSULTATION = 'prosthodontic-consultation';

    public static function isCatalogService(Service $service): bool
    {
        return isset(self::SERVICES[$service->legacy_ref]) || $service->legacy_ref === self::INTERNAL_CONSULTATION;
    }

    public static function presentation(Service $service): ?array
    {
        if (! app()->environment(['local', 'testing'])) return null;
        $definition = self::SERVICES[$service->legacy_ref] ?? null;
        if (! $definition || $service->reference_fee_php === null) return null;
        $unit = $definition[3];

        return [
            'amount_centavos' => app(\App\Services\Billing\BillingService::class)->centavos((string) $service->reference_fee_php),
            'currency' => 'PHP',
            'kind' => $unit === null || str_starts_with($unit, 'fixed:') ? 'fixed' : 'starting',
            'unit' => $unit === null ? null : (str_starts_with($unit, 'fixed:') ? substr($unit, 6) : ($unit ?: null)),
            'provisional' => true,
        ];
    }
}
