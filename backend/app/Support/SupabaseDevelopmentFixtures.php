<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\BranchService;
use App\Models\DentistBranch;
use App\Models\DentistProfile;
use App\Models\DentistServiceAssignment;
use App\Models\Patient;
use App\Models\Service;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use Database\Seeders\DemoAccountsSeeder;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

final class SupabaseDevelopmentFixtures
{
    public const COUNTS = [
        'persons' => 5, 'users' => 5, 'patients' => 1, 'branches' => 2, 'services' => 2,
        'branch_services' => 3, 'staff_profiles' => 2, 'user_branch_scopes' => 2,
        'dentist_profiles' => 1, 'dentist_branches' => 2, 'dentist_service_assignments' => 2,
    ];

    public const ACCOUNTS = [
        'owner@example.test' => 'owner',
        'staff.reception@example.test' => 'staff',
        'staff.assistant@example.test' => 'staff',
        'dentist@example.test' => 'dentist',
        'patient@example.test' => 'patient',
    ];

    // The longitudes sit on either side of the documented Bocaue map preview. These are test points, not clinic locations.
    public const BRANCHES = [
        'demo-a' => ['branch_code' => 'DEMO-A', 'name' => 'Demo branch A', 'address' => 'Synthetic test point A (no clinic address)',
            'latitude' => '14.8016000', 'longitude' => '120.9258000', 'operating_days' => [1, 3, 5]],
        'demo-b' => ['branch_code' => 'DEMO-B', 'name' => 'Demo branch B', 'address' => 'Synthetic test point B (no clinic address)',
            'latitude' => '14.8016000', 'longitude' => '120.9398000', 'operating_days' => [2, 4, 6]],
    ];

    public const SERVICES = [
        'demo-consult' => ['code' => 'DEMO-CONSULT', 'name' => 'Demo consultation', 'duration_minutes' => 30],
        'demo-follow-up' => ['code' => 'DEMO-FOLLOW-UP', 'name' => 'Demo follow-up', 'duration_minutes' => 60],
    ];

    private const STAFF_PROFILES = [
        'staff.reception@example.test' => 'demo-staff-reception',
        'staff.assistant@example.test' => 'demo-staff-assistant',
    ];

    public const OFFERINGS = [
        'demo-a' => ['demo-consult', 'demo-follow-up'],
        'demo-b' => ['demo-consult'],
    ];

    public static function fingerprint(): string
    {
        return hash('sha256', hash_file('sha256', __FILE__).hash_file('sha256', database_path('seeders/DemoAccountsSeeder.php')));
    }

    public function reconcile(bool $create): void
    {
        if ($create) {
            if (ClinicDatabaseGuard::refusal(DemoAccountsSeeder::class) !== null) {
                throw new InvalidArgumentException('The clinic database guard refused account seeding.');
            }
            app(DemoAccountsSeeder::class)->run();
        }

        $users = User::with('person')->get()->keyBy('email');
        foreach (self::ACCOUNTS as $email => $role) {
            $user = $users->get($email);
            if ($user?->role?->value !== $role || $user->account_status !== 'Active' || $user->person?->email !== $email) {
                throw new InvalidArgumentException('Existing accounts do not match the reviewed demo identities.');
            }
        }
        $patient = $users['patient@example.test'];
        $this->fixture(Patient::class, ['person_id' => $patient->person_id], ['patient_code' => 'PAT-0000', 'consent' => true], false);
        if ($patient->email_verified_at === null) {
            throw new InvalidArgumentException('The synthetic patient account is missing its reviewed verification state.');
        }

        $branches = [];
        foreach (self::BRANCHES as $ref => $attributes) {
            $branches[$ref] = $this->fixture(Branch::class, ['legacy_ref' => $ref], $attributes + [
                'city' => 'Bocaue', 'open_time' => '09:00:00', 'close_time' => '18:00:00', 'status' => 'Open',
                'phone' => null, 'email' => null, 'weekly_hours' => null,
            ], $create);
        }

        $services = [];
        foreach (self::SERVICES as $ref => $attributes) {
            $services[$ref] = $this->fixture(Service::class, ['legacy_ref' => $ref], $attributes + [
                'category' => 'Development fixture', 'description' => 'Synthetic development service.', 'status' => 'Active',
                'online_booking' => 'bookable', 'reference_fee_php' => null, 'consultation_service_id' => null,
            ], $create);
        }

        $shift = ['shift_start' => '09:00:00', 'shift_end' => '18:00:00', 'available' => true];
        foreach (self::STAFF_PROFILES as $email => $ref) {
            $staff = $users[$email];
            $branch = $branches['demo-a'];
            $this->fixture(StaffProfile::class, ['legacy_ref' => $ref], $shift + [
                'legacy_user_ref' => $staff->public_id, 'person_id' => $staff->person_id, 'branch_id' => $branch->id, 'title' => $staff->title,
            ], $create);
            $this->fixture(UserBranchScope::class, ['user_id' => $staff->id, 'branch_id' => $branch->id], [], $create);
        }

        $dentistUser = $users['dentist@example.test'];
        $dentist = $this->fixture(DentistProfile::class, ['legacy_ref' => 'demo-dentist'], $shift + [
            'legacy_user_ref' => $dentistUser->public_id, 'person_id' => $dentistUser->person_id,
            'license_no' => null, 'specialty' => null, 'assistant_staff_id' => null,
        ], $create);

        foreach (self::OFFERINGS as $branchRef => $serviceRefs) {
            $branchId = $branches[$branchRef]->id;
            $this->fixture(DentistBranch::class, ['dentist_profile_id' => $dentist->id, 'branch_id' => $branchId], [], $create);
            foreach ($serviceRefs as $serviceRef) {
                $this->fixture(BranchService::class, ['branch_id' => $branchId, 'service_id' => $services[$serviceRef]->id], [
                    'active' => true, 'duration_override_minutes' => null,
                ], $create);
            }
        }
        foreach ($services as $service) {
            $this->fixture(DentistServiceAssignment::class, ['dentist_profile_id' => $dentist->id, 'service_id' => $service->id], ['is_authorized' => true], $create);
        }
    }

    private function fixture(string $model, array $identity, array $attributes, bool $create): Model
    {
        if ($create) {
            // Attributes are fixed fixtures, including values normally set by the service commands.
            return $model::query()->forceCreate($identity + $attributes);
        }

        $record = $model::query()->where($identity)->first();
        foreach ($attributes as $key => $value) {
            if ($record?->getAttribute($key) !== $value) {
                throw new InvalidArgumentException('Existing fixture values differ for '.class_basename($model).'.');
            }
        }
        if ($record === null) {
            throw new InvalidArgumentException('An expected '.class_basename($model).' fixture is missing.');
        }

        return $record;
    }
}
