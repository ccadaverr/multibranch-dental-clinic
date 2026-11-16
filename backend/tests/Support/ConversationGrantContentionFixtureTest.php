<?php

namespace Tests\Support;

use App\Models\Patient;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Deliberately committed fixture, only in the separately approved NEW grant lab. */
final class ConversationGrantContentionFixtureTest extends TestCase
{
    use SchedulingFixture;

    public function test_prepare_owned_contention_fixture(): void
    {
        IsolatedDatabaseGuard::assertSafe($this->app);
        $target = IsolatedDatabaseGuard::manifest();
        if (getenv('DENTALOPS_GRANT_LAB') !== $target['cluster_id'] || ! str_starts_with(basename($target['runtime']), 'contention-')) {
            throw new \RuntimeException('Use the disposable grant lab only.');
        }
        $this->assertSame(0, Patient::count(), 'Never reset existing fixtures.');
        $this->setUpSchedulingWorld();
        foreach ($this->u as $key => $user) {
            $user->update(['email' => $key === 'owner' ? 'owner@example.test' : 'grant-lab-'.strtolower($key).'@example.test']);
            $user->person->update(['email' => $user->email]);
        }
        foreach (['staffB1' => 'b1', 'staffB2' => 'b2', 'staffBoth' => 'b1'] as $who => $branch) {
            \App\Models\StaffProfile::create(['person_id' => $this->u[$who]->person_id, 'legacy_ref' => 'grant-lab-'.strtolower($who),
                'legacy_user_ref' => $this->u[$who]->public_id, 'title' => 'Receptionist', 'branch_id' => $this->b[$branch]->id,
                'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true]);
        }
        foreach (['d1' => 'dentist1', 'd2' => 'dentist2', 'd3' => 'dentist3'] as $profile => $who) {
            $this->d[$profile]->update(['legacy_ref' => 'grant-lab-'.$who, 'legacy_user_ref' => $this->u[$who]->public_id]);
        }
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/conversations', ['branch_id' => $this->b['b1']->public_id, 'body' => 'Synthetic committed grant history'],
            ['Idempotency-Key' => 'grant-contention-start'])->assertCreated()->json('data.conversation.id');
        $path = $target['runtime'].'/grant-contention.json';
        file_put_contents($path, json_encode(['conversation' => $id, 'patient' => $this->p['A']->public_id, 'branch' => 'b1',
            'users' => array_map(fn ($user) => $user->id, $this->u),
            'accounts' => array_map(fn ($user) => ['public_id' => $user->public_id, 'email' => $user->email], $this->u)], JSON_THROW_ON_ERROR));
        chmod($path, 0600);
        file_put_contents($target['runtime'].'/demo-login-password', 'Passw0rd!');
        chmod($target['runtime'].'/demo-login-password', 0600);
    }
}
