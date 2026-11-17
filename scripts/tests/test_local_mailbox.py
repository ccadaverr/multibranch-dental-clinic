"""Exercise the actual loopback SMTP protocol, without external mail delivery."""
import importlib.util
from pathlib import Path
import smtplib
import socket
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('local_mailbox', Path(__file__).parents[1] / 'local-mailbox.py')
mailbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailbox)


class LocalMailboxTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.root.chmod(0o700)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        self.server = mailbox.Capture(self.root, self.port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def test_capture_acknowledges_durable_private_message_and_unstuffs_dots(self):
        with smtplib.SMTP('127.0.0.1', self.port, timeout=3) as smtp:
            self.assertEqual(smtp.sendmail('sender@example.test', ['patient@example.test'],
                                         'Subject: synthetic\r\n\r\n.first\r\n..second\r\n'), {})
        files = list((self.root / 'mailbox').glob('*.eml'))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        self.assertIn(b'\n.first\n..second', files[0].read_bytes())

    def test_real_and_mixed_recipients_refuse_entire_transaction(self):
        with smtplib.SMTP('127.0.0.1', self.port, timeout=3) as smtp:
            with self.assertRaises(smtplib.SMTPRecipientsRefused):
                smtp.sendmail('sender@example.test', ['patient@invalid.example'], 'Subject: refused\r\n\r\nbody')
            with self.assertRaises(smtplib.SMTPDataError):
                smtp.sendmail('sender@example.test', ['patient@example.test', 'patient@invalid.example'], 'Subject: refused\r\n\r\nbody')
        self.assertEqual(list((self.root / 'mailbox').glob('*.eml')), [])

    def test_guard_rejects_public_directory_privileged_port_and_fault_injection(self):
        for port, hold in [(25, False), (self.port, True)]:
            with self.assertRaises(ValueError):
                mailbox.Capture(self.root, port, hold)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            mailbox.Capture(self.root, self.port)
        self.root.chmod(0o700)
