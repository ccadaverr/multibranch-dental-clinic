#!/usr/bin/env python3
"""Reject embedded database passwords; report paths/line numbers, never values.

This focused check is not a general secret scanner or history clearance.
Run with --staged before committing; without it checks tracked working files.
"""
import argparse
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

URL = re.compile(r'postgres(?:ql)?://[^\s\"\x27]+', re.I)

def findings(text):
    lines = []
    for number, line in enumerate(text.splitlines(), 1):
        for match in URL.finditer(line):
            try:
                password = unquote(urlsplit(match.group()).password or '')
            except ValueError:
                lines.append(number)
                continue
            template = bool(re.fullmatch(r'(?:your|example|sample|placeholder)_[A-Za-z0-9_]+', password, re.I))
            reference = bool(re.fullmatch(r'\$\{[A-Za-z_][A-Za-z0-9_:]*\}', password))
            if password and not template and not reference:
                lines.append(number)
    return sorted(set(lines))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true')
    args = parser.parse_args()
    command = ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] if args.staged else ['git', 'ls-files', '-z']
    paths = subprocess.check_output(command).decode().split('\0')
    failed = False
    for path in filter(None, paths):
        data = subprocess.check_output(['git', 'show', ':'+path]) if args.staged else Path(path).read_bytes()
        if b'\0' in data:
            continue
        positions = findings(data.decode('utf-8', errors='replace'))
        if positions:
            print(f'Embedded database credential candidate: {path}, lines {positions}; value withheld.')
            failed = True
    if not failed:
        print('No non-template database password URLs found in the selected files. Other secret types/history are not cleared.')
    return int(failed)

if __name__ == '__main__':
    raise SystemExit(main())
