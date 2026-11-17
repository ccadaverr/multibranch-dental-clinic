"""Fail-closed checks: no fallback to ambient credentials, reset, migration or regular runtime writes."""
import importlib.util
from pathlib import Path
import sys
import unittest
import tempfile
import fcntl
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('runtime_lab', Path(__file__).resolve().parents[1] / 'clinical-runtime-lab.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class ClinicalRuntimeLabGuardTest(unittest.TestCase):
    def test_normal_test_profile_lock_prevents_a_concurrent_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=Path(directory)
            with (runtime/'dental_clinic_test.lock').open('a') as owner:
                fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(lab.local,'target',return_value=({'test_database':'dental_clinic_test'},runtime)),patch.object(lab.local,'verify'),patch.object(lab.local,'migrations'),patch.object(lab.local,'sql',return_value='[0,0,0,0]'),patch.object(lab.local,'clone_test') as clone:
                    with self.assertRaises(BlockingIOError):lab.run_lab('unused.json')
                    clone.assert_not_called()

    def test_missing_target_never_connects_or_clones(self):
        with patch.object(lab.local, 'verify') as verify, patch.object(lab.local, 'clone_test') as clone:
            with self.assertRaises(ValueError):
                lab.run_lab(Path('/nonexistent/clinical-runtime-target.json'))
            verify.assert_not_called()
            clone.assert_not_called()

    def test_regular_runtime_cannot_be_marked_or_reconfigured(self):
        with patch.object(lab.local, 'target', return_value=({}, Path('/private/tmp/regular-demo'))), patch.object(lab.local, 'verify') as verify:
            with self.assertRaises(ValueError):
                lab.prepare('target.json')
            verify.assert_not_called()

    def test_nonempty_source_is_never_reset_or_cloned(self):
        with patch.object(lab.local, 'target', return_value=({}, Path('/private/tmp/owned'))), \
                patch.object(lab.local, 'verify'), patch.object(lab.local, 'migrations'), \
                patch.object(lab.local, 'sql', return_value='[1,0,0,0]'), patch.object(lab.local, 'clone_test') as clone:
            with self.assertRaisesRegex(ValueError, 'nothing was reset'):
                lab.run_lab('target.json')
            clone.assert_not_called()

    def test_identity_or_schema_failure_stops_before_any_fixture_or_clone(self):
        for failing in ['verify', 'migrations']:
            with self.subTest(stage=failing), patch.object(lab.local, 'target', return_value=({}, Path('/private/tmp/owned'))), \
                    patch.object(lab.local, 'verify'), patch.object(lab.local, 'migrations'), patch.object(lab.local, 'sql') as sql, \
                    patch.object(lab.local, 'clone_test') as clone:
                with patch.object(lab.local, failing, side_effect=ValueError('identity/schema mismatch')):
                    with self.assertRaises(ValueError):
                        lab.run_lab('target.json')
                sql.assert_not_called()
                clone.assert_not_called()


if __name__ == '__main__':
    unittest.main()
