"""Database-free validation of the explicit local target boundary."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', Path(__file__).resolve().parents[1] / 'local-system.py')
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class LocalSystemTargetTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name)
        self.runtime.chmod(0o700)
        self.manifest = self.runtime / 'target.json'
        self.config = {'host': '127.0.0.1', 'port': 55488, 'root': str(local.ROOT), 'runtime': str(self.runtime),
                       'data_directory': str(self.runtime / 'postgres'), 'demo_database': 'dental_clinic_demo',
                       'test_database': 'dental_clinic_test', 'cluster_id': 'a' * 32}
        self.write()

    def tearDown(self):
        self.temp.cleanup()

    def write(self):
        self.manifest.write_text(json.dumps(self.config))
        self.manifest.chmod(0o600)

    def test_exact_private_target_is_read_without_launching_any_process(self):
        with patch.object(local.subprocess, 'check_output') as launch:
            config, runtime = local.target(self.manifest)
            self.assertEqual(config['port'], 55488)
            self.assertEqual(runtime, self.runtime)
            launch.assert_not_called()

    def test_ambient_or_foreign_targets_are_rejected_before_connecting(self):
        for field, value in [('host', 'localhost'), ('host', '192.0.2.1'), ('port', 0), ('port', 65536),
                             ('port', '55488'), ('test_database', 'dental_clinic'), ('demo_database', 'shared_staging'),
                             ('root', '/tmp/other-project'), ('data_directory', '/tmp/other-data')]:
            with self.subTest(field=field, value=value), patch.object(local.subprocess, 'check_output') as launch:
                original = self.config.copy()
                self.config[field] = value
                self.write()
                with self.assertRaises(ValueError):
                    local.target(self.manifest)
                launch.assert_not_called()
                self.config = original

    def test_public_or_linked_manifest_is_refused(self):
        self.manifest.chmod(0o644)
        with self.assertRaises(ValueError):
            local.target(self.manifest)
        self.manifest.chmod(0o600)
        alias = self.runtime / 'alias.json'
        alias.symlink_to(self.manifest)
        with self.assertRaises(ValueError):
            local.target(alias)

    def test_actual_server_identity_is_required_before_an_operation(self):
        expected = {'database': 'dental_clinic_test', 'host': '127.0.0.1', 'port': 55488,
                    'directory': str(self.runtime / 'postgres'), 'cluster_id': 'a' * 32}
        with patch.object(local, 'sql', return_value=json.dumps(expected)):
            local.verify(self.config, self.runtime, 'dental_clinic_test')
        for field in expected:
            wrong = {**expected, field: 'foreign'}
            with self.subTest(field=field), patch.object(local, 'sql', return_value=json.dumps(wrong)):
                with self.assertRaises(ValueError):
                    local.verify(self.config, self.runtime, 'dental_clinic_test')

    def test_visit_fixture_refuses_test_profile_before_snapshot_or_write(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'visit-fixture']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local, 'backup') as backup, patch.object(local.subprocess, 'check_output') as launch:
            with self.assertRaisesRegex(ValueError, 'only in the verified demo'):
                local.main()
            backup.assert_not_called()
            launch.assert_not_called()

    def test_billing_contention_refuses_regular_profile_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'billing-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_prescription_contention_refuses_regular_target_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'prescription-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_arrival_contention_refuses_regular_target_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'arrival-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_encounter_contention_refuses_regular_target_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'encounter-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_profile_contention_refuses_regular_target_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'profile-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_chart_contention_refuses_regular_target_before_launching_workers(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'chart-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_dependent_contention_refuses_regular_target(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'dependent-concurrency']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separate clone-test'):
                local.main()
            launch.assert_not_called()

    def test_backup_remains_available_while_source_migrations_are_awaiting_review(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'backup']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify') as verify, \
                patch.object(local, 'migrations', side_effect=AssertionError('do not gate backup on source')), \
                patch.object(local, 'backup') as backup:
            local.main()
            verify.assert_called_once()
            backup.assert_called_once()

    def test_reset_fixture_suite_is_refused_before_php_execution(self):
        args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test', 'test',
                'tests/Feature/Followups/Follow02AtomicTransitionsTest.php']
        with patch.object(sys, 'argv', args), patch.object(local, 'verify'), patch.object(local, 'migrations'), \
                patch.object(local.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'separately reviewed'):
                local.main()
            launch.assert_not_called()

    def test_suite_mail_defaults_are_opt_in_and_do_not_change_target_or_database_identity(self):
        for mode in ['target', 'suite']:
            args = ['local-system.py', '--target', str(self.manifest), '--profile', 'test',
                    '--test-mail-profile', mode, 'test', 'tests/Feature/Intake/IntakeTest.php']
            self.config['php'] = '/synthetic/php'
            self.write()
            original = {'MAIL_MAILER': 'local_capture', 'QUEUE_CONNECTION': 'database', 'DB_DATABASE': 'dental_clinic_test',
                        'DB_HOST': '127.0.0.1', 'DB_PORT': '55488', 'DENTALOPS_LOCAL_TARGET': str(self.manifest)}
            with patch.object(sys, 'argv', args), patch.object(local, 'verify') as verify, patch.object(local, 'migrations'), \
                    patch.object(local, 'environment', return_value=original.copy()), patch.object(local.subprocess, 'run') as launch:
                local.main()
                verify.assert_called_once_with(self.config, self.runtime, 'dental_clinic_test')
                actual = launch.call_args.kwargs['env']
                expected = {**original, **({'MAIL_MAILER': 'array', 'QUEUE_CONNECTION': 'sync'} if mode == 'suite' else {})}
                self.assertEqual(actual, expected)

    def test_suite_mail_profile_cannot_change_demo_services_or_other_test_lanes(self):
        for profile, action in [('demo', 'test'), ('demo', 'serve'), ('demo', 'worker'), ('demo', 'scheduler'),
                                ('test', 'verify-schema'), ('test', 'chart-concurrency')]:
            args = ['local-system.py', '--target', str(self.manifest), '--profile', profile,
                    '--test-mail-profile', 'suite', action]
            with patch.object(sys, 'argv', args), patch.object(local, 'verify') as verify, patch.object(local.subprocess, 'run') as launch:
                with self.assertRaisesRegex(ValueError, 'only for explicit test'):
                    local.main()
                verify.assert_not_called()
                launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
