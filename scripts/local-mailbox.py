#!/usr/bin/env python3
"""Local development SMTP capture only. Never relays or contacts a recipient's mail server."""
# Uses macOS's existing Python3.9 SMTP module, not a production SMTP service.
import asyncore
import os
from pathlib import Path
import secrets
import smtpd
import sys
import time

runtime = Path(sys.argv[1]).resolve()
if runtime.stat().st_uid != os.getuid() or runtime.stat().st_mode & 0o077:
    raise RuntimeError('An owned private runtime is required.')
mailbox = runtime / 'mailbox'
mailbox.mkdir(mode=0o700, exist_ok=True)
mailbox.chmod(0o700)
port = int(sys.argv[2]) if len(sys.argv) > 2 else 1026
if not 1024 <= port <= 65535:
    raise ValueError('Use an unprivileged loopback capture port.')
hold = len(sys.argv) > 3 and sys.argv[3] == '--hold-before-capture'
if hold and (not runtime.name.startswith('contention-') or not (runtime / 'clinical-runtime-lab').is_file()):
    raise ValueError('Fault injection requires a disposable clinical runtime lab.')


class Capture(smtpd.SMTPServer):
    def process_message(self, peer, sender, recipients, data, **kwargs):
        if not recipients or any(not address.lower().endswith('@example.test') for address in recipients):
            return '550 This development mailbox accepts synthetic example.test recipients only'
        if hold:
            # Fault injection in a private disposable lab: kill this process before releasing the worker.
            marker = runtime / 'capture-blocked'
            with os.fdopen(os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as blocked:
                blocked.write('Synthetic DATA received; not captured or acknowledged.\n')
            while True:
                time.sleep(0.05)
        path = mailbox / (secrets.token_hex(16) + '.eml')
        with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as message:
            message.write(data)
        # Message content, codes, recipient identities and headers are never written to process logs.
        return None


Capture(('127.0.0.1', port), None, decode_data=False)
print('Local SMTP capture ready on 127.0.0.1:'+str(port)+'; no relay or external delivery.', flush=True)
asyncore.loop()
