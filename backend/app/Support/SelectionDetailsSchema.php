<?php

namespace App\Support;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Schema;

/** Readiness is not installation authority. No DDL, fallback storage or inferred historical category. */
final class SelectionDetailsSchema
{
    public const COLUMNS = [
        'assistant_answers' => ['category_detail'],
        'appointments' => ['cancellation_category', 'cancellation_detail', 'cancellation_actor_role'],
        'followup_tasks' => ['reason_category'],
        'treatments' => ['followup_reason_category'],
        'prescription_lines' => ['value_origins'],
    ];

    public static function available(): bool
    {
        $key = self::class.'.readiness';
        if (! app()->bound($key)) {
            $ready = true;
            foreach (self::COLUMNS as $table => $columns) {
                if (! Schema::hasColumns($table, $columns)) {
                    $ready = false;
                    break;
                }
            }
            app()->instance($key, $ready);
        }

        return app($key);
    }

    public static function requireRequested(array $data, array $keys): void
    {
        if (self::available()) {
            return;
        }
        foreach ($keys as $key) {
            if (isset($data[$key]) && $data[$key] !== []) {
                throw new HttpResponseException(response()->json([
                    'code' => 'selection_details_unavailable',
                    'message' => 'Category tracking is unavailable. Reload before using the recorded-text workflow.',
                ], 503)->header('Cache-Control', 'private, no-store'));
            }
        }
    }
}
