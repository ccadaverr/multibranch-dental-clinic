#!/usr/bin/env python3
"""Local development SMTP capture only. Never relays or contacts a recipient's mail server."""
import os
from pathlib import Path
import re
import secrets
import socketserver
import sys
import threading
import time

MAX_MESSAGE = 10 * 1024 * 1024


class Capture(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, runtime, port, hold=False):
        runtime = Path(runtime)
        if runtime.is_symlink() or runtime.stat().st_uid != os.getuid() or runtime.stat().st_mode & 0o077:
            raise ValueError('An owned private runtime is required.')
        if not 1024 <= port <= 65535:
            raise ValueError('Use an unprivileged loopback capture port.')
        if hold and (not runtime.name.startswith('contention-') or not (runtime / 'clinical-runtime-lab').is_file()):
            raise ValueError('Fault injection requires a disposable clinical runtime lab.')
        self.runtime, self.hold = runtime, hold
        self.mailbox = runtime / 'mailbox'
        if self.mailbox.is_symlink():
            raise ValueError('A private mailbox directory is required.')
        self.mailbox.mkdir(mode=0o700, exist_ok=True)
        self.mailbox.chmod(0o700)
        self.capacity = threading.BoundedSemaphore(16)
        super().__init__(('127.0.0.1', port), SmtpSession)

    def process_request(self, request, address):
        if not self.capacity.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.capacity.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.capacity.release()

    def handle_error(self, request, address):
        # Never log message bodies, headers, codes, recipients or authentication material.
        pass


class SmtpSession(socketserver.StreamRequestHandler):
    def reply(self, text):
        self.wfile.write(text.encode('ascii') + b'\r\n')

    def handle(self):
        self.request.settimeout(30)
        self.reply('220 localhost synthetic capture')
        sender, recipients, refused = False, [], False
        while True:
            line = self.rfile.readline(4097)
            if not line or len(line) > 4096:
                return
            command, _, argument = line.decode('ascii', errors='replace').strip().partition(' ')
            command = command.upper()
            if command in ['EHLO', 'HELO']:
                sender, recipients, refused = False, [], False
                self.reply('250-localhost\r\n250 SIZE ' + str(MAX_MESSAGE))
            elif command == 'MAIL' and re.fullmatch(r'FROM:\s*<[^<>\r\n]*>(?: SIZE=\d+)?', argument, re.I):
                sender, recipients, refused = True, [], False
                self.reply('250 OK')
            elif command == 'RCPT' and sender:
                match = re.fullmatch(r'TO:\s*<([^<>\s]+)>', argument, re.I)
                if not match or not re.fullmatch(r'[^@]+@example\.test', match[1], re.I):
                    refused = True
                    self.reply('550 Synthetic example.test recipients only')
                else:
                    recipients.append(match[1])
                    self.reply('250 OK')
            elif command == 'DATA' and sender and recipients and not refused:
                self.reply('354 End with a single dot')
                parts, size, oversized = [], 0, False
                while True:
                    data = self.rfile.readline(MAX_MESSAGE + 1)
                    if not data:
                        return
                    if data in [b'.\r\n', b'.\n']:
                        break
                    size += len(data)
                    oversized = oversized or size > MAX_MESSAGE
                    if not oversized:
                        parts.append((data[1:] if data.startswith(b'..') else data).rstrip(b'\r\n'))
                if oversized:
                    self.reply('552 Message exceeds local capture limit')
                else:
                    if self.server.hold:
                        marker = self.server.runtime / 'capture-blocked'
                        with os.fdopen(os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as blocked:
                            blocked.write('Synthetic DATA received; not captured or acknowledged.\n')
                        while True:
                            time.sleep(0.05)
                    path = self.server.mailbox / (secrets.token_hex(16) + '.eml')
                    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as message:
                        message.write(b'\n'.join(parts))
                        message.flush()
                        os.fsync(message.fileno())
                    self.reply('250 Captured locally; no external delivery')
                sender, recipients, refused = False, [], False
            elif command == 'RSET':
                sender, recipients, refused = False, [], False
                self.reply('250 OK')
            elif command == 'NOOP':
                self.reply('250 OK')
            elif command == 'QUIT':
                self.reply('221 Bye')
                return
            else:
                self.reply('503 Unsupported command or invalid transaction')


if __name__ == '__main__':
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 1026
    with Capture(sys.argv[1], port, len(sys.argv) > 3 and sys.argv[3] == '--hold-before-capture') as server:
        print('Local SMTP capture ready on 127.0.0.1:'+str(port)+'; no relay or external delivery.', flush=True)
        server.serve_forever()
