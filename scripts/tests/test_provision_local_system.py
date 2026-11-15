"""Fresh-cluster preflight must refuse existing/unsafe targets before provisioning anything."""
import importlib.util
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('provision', Path(__file__).resolve().parents[1] / 'provision-local-system.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)

class ProvisionBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dops-')
        self.base = Path(self.temp.name)
        self.binary = self.base / 'php'
        self.binary.touch(); self.binary.chmod(0o700)
        for name in ['initdb', 'pg_ctl', 'psql', 'createdb', 'pg_dump', 'pg_restore']:
            f = self.base / name; f.touch(); f.chmod(0o700)
    def tearDown(self):
        self.temp.cleanup()
    def test_existing_runtime_is_never_adopted_or_modified(self):
        marker = self.base / 'existing'; marker.mkdir(); (marker / 'keep').write_text('original')
        with patch.object(provision.subprocess, 'run') as launch, self.assertRaises(ValueError):
            provision.provision(marker, 55489, self.binary, self.base)
        launch.assert_not_called(); self.assertEqual((marker / 'keep').read_text(), 'original')
    def test_shared_port_is_refused_before_runtime_creation(self):
        destination = self.base / 'new'
        with self.assertRaises(ValueError): provision.validate(destination, 5432, self.binary, self.base)
        self.assertFalse(destination.exists())
    def test_checkout_runtime_is_refused(self):
        with self.assertRaises(ValueError): provision.validate(provision.ROOT / 'never-create-runtime', 55489, self.binary, self.base)
    def test_busy_port_never_adopts_the_listening_server(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            with self.assertRaises(OSError): provision.validate(self.base / 'new', port, self.binary, self.base)
        self.assertFalse((self.base / 'new').exists())
    def test_missing_executable_refused_before_runtime_creation(self):
        with self.assertRaises(ValueError): provision.validate(self.base / 'new', 55489, self.base / 'absent', self.base)
        self.assertFalse((self.base / 'new').exists())

if __name__ == '__main__': unittest.main()
