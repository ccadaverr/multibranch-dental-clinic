<?php

namespace Tests\Feature\Archives;

use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Copy into a verified private test checkout. The proposed acceptance test is red at the Round 8 baseline. */
class AppointmentReadPrivacyProbeTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    private const PRIVATE_MARKER = 'Synthetic private appointment marker';

    private function cases(): array
    {
        config(['app.debug' => false]);
        $this->setUpSchedulingWorld();
        $own = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '09:00');
        $foreign = $this->existing('B', 'd3', 'b2', 'svc1', '2026-09-28', '09:00');
        $foreign->forceFill(['notes' => self::PRIVATE_MARKER])->saveOrFail();
        $missing = strtolower((string) Str::ulid());
        $uri = fn ($id) => '/api/appointments/'.$id;
        $responses = [
            'guest.existing' => $this->getJson($uri($foreign->public_id))->assertUnauthorized(),
            'guest.missing' => $this->getJson($uri($missing))->assertUnauthorized(),
        ];

        foreach (['patientA', 'staffB1', 'dentist1'] as $role) {
            $this->actingAsUser($role);
            $responses[$role.'.permitted'] = $this->getJson($uri($own->public_id))
                ->assertOk()->assertJsonPath('data.id', $own->public_id)
                ->assertJsonPath('data.patient.id', $this->p['A']->public_id)
                ->assertJsonPath('data.branch.id', 'b1');
            $responses[$role.'.foreign'] = $this->getJson($uri($foreign->public_id));
            $responses[$role.'.missing'] = $this->getJson($uri($missing));
        }

        $this->actingAsUser('owner');
        $responses['owner.permitted'] = $this->getJson($uri($foreign->public_id))->assertOk()
            ->assertJsonPath('data.id', $foreign->public_id)->assertJsonPath('data.notes', self::PRIVATE_MARKER);
        $responses['owner.internal_id'] = $this->getJson($uri($foreign->id));

        $this->actingAsUser('staffB1');
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->where('branch_id', $this->b['b1']->id)
            ->update(['branch_id' => $this->b['b2']->id]);
        $responses['staffB1.removed_scope'] = $this->getJson($uri($own->public_id));
        $responses['staffB1.new_scope'] = $this->getJson($uri($foreign->public_id))->assertOk()
            ->assertJsonPath('data.id', $foreign->public_id);

        $this->u['staffB1']->forceFill(['account_status' => 'Inactive'])->saveOrFail();
        $responses['revoked.existing'] = $this->getJson($uri($foreign->public_id));
        $responses['revoked.missing'] = $this->getJson($uri($missing));

        return ['responses' => $responses, 'ids' => [$missing, $own->public_id, $foreign->public_id, (string) $foreign->id]];
    }

    private function safeShape(TestResponse $response, array $ids): array
    {
        $body = $response->json();
        if ($response->isOk()) {
            return ['status' => 200, 'keys' => array_keys($body), 'data_keys' => array_keys($body['data'])];
        }

        return [
            'status' => $response->status(),
            'keys' => array_keys($body),
            'message' => str_replace($ids, '<fixture-id>', $body['message'] ?? ''),
            'code' => $body['code'] ?? null,
        ];
    }

    public function test_records_appointment_read_matrix_without_logging_payload_values(): void
    {
        ['responses' => $responses, 'ids' => $ids] = $this->cases();
        $observations = [];
        foreach ($responses as $scenario => $response) {
            if (! $response->isOk()) {
                $this->assertContains($response->status(), [401, 403, 404], $scenario);
                $this->assertArrayNotHasKey('data', $response->json(), $scenario);
                $this->assertStringNotContainsString(self::PRIVATE_MARKER, $response->getContent(), $scenario);
                $this->assertArrayNotHasKey('trace', $response->json(), $scenario);
            }
            $observations[$scenario] = $this->safeShape($response, $ids);
        }
        fwrite(STDOUT, PHP_EOL.json_encode($observations, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).PHP_EOL);
    }

    public function test_direct_read_does_not_disclose_whether_a_denied_appointment_exists(): void
    {
        ['responses' => $responses] = $this->cases();
        $expected = ['message' => 'Appointment not found.'];
        $observed = [];
        foreach (['patientA.foreign', 'patientA.missing', 'staffB1.foreign', 'staffB1.missing', 'staffB1.removed_scope',
            'dentist1.foreign', 'dentist1.missing', 'owner.internal_id'] as $scenario) {
            $response = $responses[$scenario];
            $observed[$scenario] = [$response->status(), $response->json()];
        }
        // Compare raw response bodies so an echoed identifier or exception class also fails.
        $this->assertSame(array_fill_keys(array_keys($observed), [404, $expected]), $observed);
        $this->assertSame(
            [$responses['revoked.existing']->status(), $responses['revoked.existing']->json()],
            [$responses['revoked.missing']->status(), $responses['revoked.missing']->json()],
        );
        $responses['revoked.existing']->assertForbidden()->assertJsonPath('code', 'session_revoked');
        $this->assertSame($responses['guest.existing']->json(), $responses['guest.missing']->json());
    }
}
