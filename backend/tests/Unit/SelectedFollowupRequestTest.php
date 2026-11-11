<?php

namespace Tests\Unit;

use App\Enums\Role;
use App\Http\Requests\Appointment\StoreAppointmentRequest;
use App\Models\User;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Exercises the real request's new rules only; no exists rule, application bootstrap or database. */
final class SelectedFollowupRequestTest extends TestCase
{
    private const TASK = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

    private function request(array $input, Role $role = Role::Staff): StoreAppointmentRequest
    {
        $request = StoreAppointmentRequest::create('/api/appointments', 'POST', $input);
        $user = new User();
        $user->role = $role;
        $request->setUserResolver(fn () => $user);

        return $request;
    }

    public static function combinations(): array
    {
        return [
            'ordinary' => [[], true],
            'selected' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => 7], true],
            'numeric revision string' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => '7'], true],
            'missing revision' => [['followup_task_id' => self::TASK], false],
            'missing identity' => [['followup_expected_revision' => 7], false],
            'explicit nulls' => [['followup_task_id' => null, 'followup_expected_revision' => null], false],
            'empty identity' => [['followup_task_id' => '', 'followup_expected_revision' => 7], false],
            'bigint is not public identity' => [['followup_task_id' => '123', 'followup_expected_revision' => 7], false],
            'malformed identity' => [['followup_task_id' => str_repeat('Z', 26), 'followup_expected_revision' => 7], false],
            'zero revision' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => 0], false],
            'negative revision' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => -1], false],
            'fractional revision' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => 1.5], false],
            'oversized revision' => [['followup_task_id' => self::TASK, 'followup_expected_revision' => 2147483648], false],
        ];
    }

    #[DataProvider('combinations')]
    public function test_paired_selected_fields_are_validated(array $input, bool $valid): void
    {
        $request = $this->request($input);
        $rules = array_intersect_key($request->rules(), array_flip(['followup_task_id', 'followup_expected_revision']));
        $validator = (new Factory(new Translator(new ArrayLoader(), 'en')))->make($input, $rules);
        self::assertSame($valid, $validator->passes());
    }

    public static function roles(): array
    {
        return array_map(fn (Role $role) => [$role], Role::cases());
    }

    #[DataProvider('roles')]
    public function test_only_staff_may_supply_selected_task_fields(Role $role): void
    {
        self::assertTrue($this->request([], $role)->authorize(), 'Ordinary booking authorization remains in the existing policy.');
        self::assertSame($role === Role::Staff, $this->request(['followup_task_id' => self::TASK, 'followup_expected_revision' => 7], $role)->authorize());
    }
}
