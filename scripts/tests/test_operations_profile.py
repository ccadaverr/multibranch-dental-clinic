"""Explicit Operations opt-in cannot silently add migrations to the base preservation profile."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('operations_local', Path(__file__).resolve().parents[1] / 'local-system.py')
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class OperationsProfileTest(unittest.TestCase):
    def manifest(self, enabled):
        files = sorted((local.ROOT / 'backend/database/migrations').glob('*.php')) + sorted((local.ROOT / 'backend/database/compatibility').glob('*.php'))
        extensions = enabled if isinstance(enabled, list) else (local.OPERATIONS_MIGRATIONS if enabled else [])
        files += [local.ROOT / 'backend/database/operations' / name for name in extensions]
        return {'operations_migrations': extensions,
                'migration_hashes': {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files},
                'selected_migrations': [f.stem for f in files if f.name not in local.HELD]}

    def test_base_and_operations_keep_all_four_holds(self):
        for enabled, count in [(False, 83), (True, 84), (local.ROSTER_DRAFT_MIGRATIONS, 84), (local.OPERATIONS_MIGRATIONS + local.ROSTER_DRAFT_MIGRATIONS, 85)]:
            selected = local.migrations(self.manifest(enabled))
            self.assertEqual(len(selected), count)
            self.assertFalse(local.HELD.intersection(f.name for f in selected))

    def test_unknown_extension_and_changed_hash_are_refused(self):
        bad = self.manifest(True)
        bad['operations_migrations'] = ['../unreviewed.php']
        with self.assertRaises(ValueError): local.migrations(bad)
        bad = self.manifest(True)
        bad['migration_hashes'][local.OPERATIONS_MIGRATIONS[0]] = 'wrong'
        with self.assertRaises(ValueError): local.migrations(bad)


if __name__ == '__main__': unittest.main()
