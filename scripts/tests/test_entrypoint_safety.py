"""No database or Docker daemon required; reject unsafe startup before any side effect."""
import os
from pathlib import Path
import subprocess
import unittest
import configparser
import re

ENTRYPOINT = Path(__file__).resolve().parents[2] / 'backend/docker/entrypoint.sh'

class EntrypointSafetyTest(unittest.TestCase):
    def test_automatic_default_migrations_are_refused_before_startup(self):
        result = subprocess.run(['bash', str(ENTRYPOINT)], env={**os.environ, 'AUTO_MIGRATE': 'true'}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('reviewed migration profile', result.stderr)
        self.assertEqual(result.stdout, '')

    def test_shell_is_valid_and_no_migration_command_remains(self):
        subprocess.run(['bash', '-n', str(ENTRYPOINT)], check=True)
        self.assertNotIn('artisan migrate', ENTRYPOINT.read_text())

    def test_versioned_worker_budget_precedes_reservation_and_outbox_reclaim(self):
        root = ENTRYPOINT.parents[2]
        config = configparser.ConfigParser(interpolation=None)
        config.read(root / 'backend/docker/supervisord.conf')
        worker = int(re.search(r'--timeout=(\d+)', config['program:laravel-worker']['command'])[1])
        retry = int(re.search(r"DB_QUEUE_RETRY_AFTER', (\d+)", (root / 'backend/config/queue.php').read_text())[1])
        claim = int(re.search(r"MAIL_PROCESSING_TIMEOUT_SECONDS', (\d+)", (root / 'backend/config/clinic.php').read_text())[1])
        self.assertLess(worker, retry)
        self.assertLess(worker, claim)
        self.assertIn("'--timeout=" + str(worker) + "'", (root / 'scripts/local-system.py').read_text())

if __name__ == '__main__':
    unittest.main()
