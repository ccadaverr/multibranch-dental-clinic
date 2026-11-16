"""No database or Docker daemon required; reject unsafe startup before any side effect."""
import os
from pathlib import Path
import subprocess
import unittest

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

if __name__ == '__main__':
    unittest.main()
