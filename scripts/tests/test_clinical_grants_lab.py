"""Grant proposal guard failures cannot import, migrate or mutate an existing service."""
import importlib.util
from pathlib import Path
import sys
import unittest
import tempfile
import fcntl
from unittest.mock import patch

sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('grants_lab',Path(__file__).resolve().parents[1]/'clinical-grants-lab.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


class GrantLabGuardTest(unittest.TestCase):
    def test_changed_proposal_is_refused_before_database_access(self):
        with patch.object(lab,'REVIEWED_SHA256','unreviewed'),patch.object(lab.local,'target') as target:
            with self.assertRaisesRegex(ValueError,'new separate review'):lab.run('unused.json')
            target.assert_not_called()

    def test_missing_target_has_no_ambient_database_fallback(self):
        with patch.object(lab.local,'verify') as verify,patch.object(lab.local,'clone_test') as clone:
            with self.assertRaises(ValueError):lab.run('/nonexistent/grant-target.json')
            verify.assert_not_called();clone.assert_not_called()

    def test_nonempty_source_is_never_cloned_reset_or_migrated(self):
        with patch.object(lab.local,'target',return_value=({},Path('/private/tmp/owned'))),patch.object(lab.local,'verify'),patch.object(lab.local,'migrations'),patch.object(lab.local,'sql',return_value='1'),patch.object(lab.local,'clone_test') as clone:
            with self.assertRaisesRegex(ValueError,'Nothing was reset'):lab.run('unused.json')
            clone.assert_not_called()

    def test_mismatched_server_or_schema_stops_before_clone(self):
        for stage in ['verify','migrations']:
            with self.subTest(stage=stage),patch.object(lab.local,'target',return_value=({},Path('/private/tmp/owned'))),patch.object(lab.local,'verify'),patch.object(lab.local,'migrations'),patch.object(lab.local,'clone_test') as clone:
                with patch.object(lab.local,stage,side_effect=ValueError('mismatch')):
                    with self.assertRaises(ValueError):lab.run('unused.json')
                clone.assert_not_called()

    def test_normal_test_profile_lock_prevents_a_concurrent_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=Path(directory)
            with (runtime/'dental_clinic_test.lock').open('a') as owner:
                fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(lab.local,'target',return_value=({'test_database':'dental_clinic_test'},runtime)),patch.object(lab.local,'verify'),patch.object(lab.local,'migrations'),patch.object(lab.local,'sql',return_value='0'),patch.object(lab.local,'clone_test') as clone:
                    with self.assertRaises(BlockingIOError):lab.run('unused.json')
                    clone.assert_not_called()
