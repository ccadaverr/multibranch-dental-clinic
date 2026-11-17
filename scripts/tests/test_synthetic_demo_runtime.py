"""Mutation boundaries: historical records and unreviewed schemas are never reset or cloned."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('synthetic',Path(__file__).resolve().parents[1]/'synthetic-demo-runtime.py')
runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)


class SyntheticBoundaryTest(unittest.TestCase):
    def test_nonempty_source_is_refused_without_reset_or_clone(self):
        files=[Path(str(i)+'.php') for i in range(87)]
        ledger='\n'.join(p.stem for p in files)
        for counts in ['[1,0,0,0,0]','[0,1,0,0,0]','[0,0,14,0,0]','[0,0,0,14,0]','[0,0,0,0,1]']:
            with self.subTest(counts=counts),patch.object(runtime.local,'verify'),patch.object(runtime.local,'migrations',return_value=files),patch.object(runtime.local,'sql',side_effect=[ledger,counts]),self.assertRaises(ValueError):
                runtime.empty_source({},Path('/unused'))

    def test_unreviewed_migration_or_wrong_ledger_is_rejected(self):
        for files,ledger in [([Path(str(i)+'.php') for i in range(88)],''),([Path(str(i)+'.php') for i in range(87)],'unknown')]:
            with patch.object(runtime.local,'verify'),patch.object(runtime.local,'migrations',return_value=files),patch.object(runtime.local,'sql',return_value=ledger),self.assertRaises(ValueError):
                runtime.empty_source({},Path('/unused'))

    def test_empty_reviewed_schema_is_allowed_without_database_mutation(self):
        files=[Path(str(i)+'.php') for i in range(87)]
        with patch.object(runtime.local,'verify'),patch.object(runtime.local,'migrations',return_value=files),patch.object(runtime.local,'sql',side_effect=['\n'.join(p.stem for p in files),'[0,0,0,0,0]']),patch.object(runtime.local,'clone_test') as clone:
            runtime.empty_source({},Path('/unused'));clone.assert_not_called()

    def test_privileged_and_invalid_ports_are_rejected(self):
        for port in [0,80,543,65536,-1]:
            with self.subTest(port=port),self.assertRaises(ValueError):runtime.port_number(port)


if __name__=='__main__':unittest.main()
