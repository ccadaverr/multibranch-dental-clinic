#!/usr/bin/env python3
"""Read-only verification of the original QA ledger against its authoritative source."""
from collections import Counter
from html import unescape
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
source = (root / 'FINALS-QA-REVISIONS.md').read_text()
expected = {}
for match in re.finditer(r'<revision id="((?:GEN|STF|DEN|OWN)-\d+)"([^>]*)>(.*?)</revision>', source, re.S):
    qa, attributes, body = match.groups()
    assert qa not in expected, f'Duplicate source ID: {qa}'
    owner = re.search(r'owner="([^"]+)"', attributes)[1]
    acceptance = re.search(r'<acceptance>(.*?)</acceptance>', body, re.S)[1].strip()
    tasks = re.search(r'<tasks>(.*?)</tasks>', body, re.S)
    wording = [re.sub(r'^\s*- \[[ x]\] ', '', line).strip() for line in tasks[1].splitlines()
               if re.match(r'\s*- \[[ x]\]', line)] if tasks else []
    expected[qa] = (owner, acceptance, wording)

ledger = (root / 'docs/QA_RECONCILIATION_20261116.md').read_text()
seen, counts = set(), Counter()
for line in ledger.splitlines():
    if not re.match(r'\| (GEN|STF|DEN|OWN)-\d+ /', line):
        continue
    cells = [unescape(cell.strip()) for cell in line.strip('|').split(' | ')]
    assert len(cells) == 10, f'Expected 10 columns: {cells[0]}'
    qa, owner = cells[0].split(' / ')
    assert qa not in seen, f'Duplicate ledger ID: {qa}'
    seen.add(qa)
    original_owner, acceptance, tasks = expected[qa]
    assert owner == original_owner, f'Original owner changed: {qa}'
    assert cells[1].startswith(acceptance + '<br>Original tasks: '), f'Acceptance wording changed: {qa}'
    for wording in tasks:
        assert wording in cells[1], f'Original task omitted/changed: {qa}: {wording}'
    assert all(cells), f'Missing evidence/scope column: {qa}'
    assert cells[5] in {'Complete', 'Partial', 'Blocked'}, f'Unknown status: {qa}'
    counts[cells[5]] += 1
assert seen == expected.keys() and len(seen) == 68, 'Original 68-ID set changed'
assert sum(counts.values()) == 68
print('Verified 68 original IDs, exact acceptance/task wording, original owners and 10 populated columns.')
print(dict(counts))
