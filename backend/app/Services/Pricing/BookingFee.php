<?php

namespace App\Services\Pricing;

use App\Models\Branch;
use App\Models\Service;
use App\Support\DevelopmentClinicCatalog as Catalog;

final class BookingFee
{
    public static function resolve(Service $service, Branch $branch, string $date): ?string
    {
        $price = app(PriceResolver::class)->resolve($service, $branch, $date);
        if ($price instanceof ResolvedPrice) return $price->amount();

        return self::developmentAmount($service);
    }

    public static function developmentAmount(Service $service): ?string
    {
        $testCatalog = Catalog::isCatalogService($service)
            && app()->environment('local') && config('services.paymongo.mode') === 'test'
            && config('services.paymongo.provisional_booking_prices') === true;

        // The fallback is only for the first appointment in a sandbox. It never enters M13 or treatment billing.
        return $testCatalog && $service->online_booking === 'bookable' ? $service->reference_fee_php : null;
    }
}
