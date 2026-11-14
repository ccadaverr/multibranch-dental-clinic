#!/usr/bin/env python3
"""Local development SMTP capture only. Never relays or contacts a recipient's mail server."""
# Uses macOS's existing Python3.9 SMTP module, not a production SMTP service.
import asyncore
import os
from pathlib import Path
import secrets
import smtpd
import sys

runtime = Path(sys.argv[1]).resolve()
if runtime.stat().st_uid != os.getuid() or runtime.stat().st_mode & 0o077:
    raise RuntimeError('An owned private runtime is required.')
mailbox = runtime / 'mailbox'
mailbox.mkdir(mode=0o700, exist_ok=True)
mailbox.chmod(0o700)


class Capture(smtpd.SMTPServer):
    def process_message(self, peer, sender, recipients, data, **kwargs):
        if not recipients or any(not address.lower().endswith('@example.test') for address in recipients):
            return '550 This development mailbox accepts synthetic example.test recipients only'
        path = mailbox / (secrets.token_hex(16) + '.eml')
        with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as message:
            message.write(data)
        # Message content, codes, recipient identities and headers are never written to process logs.
        return None


Capture(('127.0.0.1', 1026), None, decode_data=False)
print('Local SMTP capture ready on127.0.0.1:1026; no relay or external delivery.', flush=True)
asyncore.loop()
