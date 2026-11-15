<?php

namespace Tests\Unit;

use App\Http\Requests\Reference\UpdateStaffProfileRequest;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use PHPUnit\Framework\TestCase;

/** Actual request rules, without creating an application or opening a database connection. */
class StaffShiftValidationTest extends TestCase
{
    public function test_comparison_and_operation_are_required_together_without_breaking_legacy_clients(): void
    {
        $factory = new Factory(new Translator(new ArrayLoader, 'en'));
        $rules = (new UpdateStaffProfileRequest)->rules();
        $body = ['shift_start' => '09:00', 'shift_end' => '17:00'];
        $comparison = ['expected_revision' => str_repeat('a', 64), 'operation_id' => '11111111-1111-4111-8111-111111111111'];
        $this->assertTrue($factory->make($body, $rules)->passes());
        $this->assertTrue($factory->make($body + $comparison, $rules)->passes());
        foreach (array_keys($comparison) as $field) {
            $partial = $comparison;
            unset($partial[$field]);
            $this->assertTrue($factory->make($body + $partial, $rules)->errors()->has($field));
        }
        foreach ([['expected_revision' => 'invalid'], ['operation_id' => 'invalid'], ['expected_revision' => null], ['operation_id' => null]] as $bad) {
            $this->assertTrue($factory->make($body + array_replace($comparison, $bad), $rules)->fails());
        }
        $this->assertTrue($factory->make(['shift_end' => '19:00'], $rules)->passes(), 'Single-field interval comparison happens against persisted state under the controller lock.');
        $this->assertTrue($factory->make(['shift_start' => '25:00'], $rules)->fails());
    }
}
