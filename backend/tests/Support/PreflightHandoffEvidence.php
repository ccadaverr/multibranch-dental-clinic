<?php

namespace Tests\Support;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Foundation\Application;
use RuntimeException;

/**
 * Test-only, in-process evidence for a simulated handoff. Not an execution runner.
 * Exact reference/snapshot comparisons cannot establish infrastructure identity or mutation history.
 */
final class PreflightHandoffEvidence
{
    private bool $usable = true;

    private function __construct(
        private readonly Application $application,
        private readonly DatabaseManager $manager,
        private readonly Repository $configuration,
        private readonly array $snapshot,
    ) {}

    public static function capture(Application $app, DatabaseManager $manager): self
    {
        $config = $app['config'];
        $snapshot = self::snapshot($config);
        PreflightConfigurationValidator::assertSafe($app, $manager);
        self::assertSnapshot($app, $config, $snapshot);
        return new self($app, $manager, $config, $snapshot);
    }

    /** Consumes evidence even on rejection. Does not invoke a callback or execute database work. */
    public function consumeBeforeSimulatedHandoff(Application $app, DatabaseManager $manager): void
    {
        if (! $this->usable) {
            throw new RuntimeException('Preflight evidence is unavailable or already consumed.');
        }
        $this->usable = false;
        if ($app !== $this->application || $manager !== $this->manager) {
            throw new RuntimeException('Preflight evidence dependency identity changed.');
        }
        self::assertSnapshot($app, $this->configuration, $this->snapshot);
        // Re-observe cache/environment and resolved objects rather than trusting earlier acceptance.
        PreflightConfigurationValidator::assertSafe($app, $manager);
        self::assertSnapshot($app, $this->configuration, $this->snapshot);
    }

    public function invalidate(): void
    {
        $this->usable = false;
    }

    public function __serialize(): array
    {
        // Snapshots can contain credential strings. Never turn this evidence into a persisted token.
        throw new RuntimeException('Preflight evidence cannot be serialized.');
    }

    private static function snapshot(Repository $config): array
    {
        return ['default' => $config->get('database.default'), 'connections' => $config->get('database.connections')];
    }

    private static function assertSnapshot(Application $app, Repository $config, array $snapshot): void
    {
        if ($app['config'] !== $config || self::snapshot($config) !== $snapshot) {
            throw new RuntimeException('Preflight evidence configuration changed.');
        }
    }
}
