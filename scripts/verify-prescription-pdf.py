#!/usr/bin/env python3
"""Parse actual synthetic acceptance downloads; pypdf is installed only in private test tooling."""
import argparse
import json
from pathlib import Path
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('evidence', type=Path)
args = parser.parse_args()
state = json.loads((args.evidence / 'journey.json').read_text())
results = []
normalize = lambda value: re.sub(r'\s+', ' ', str(value)).strip()
for file, record, status in [('issued.pdf', state['issued'], 'Issued'), ('void.pdf', state['voided'], 'VOID')]:
    pdf = PdfReader(args.evidence / file, strict=True)
    content = normalize(' '.join(page.extract_text() for page in pdf.pages))
    for page in pdf.pages:
        assert abs(float(page.mediabox.width) - 595.28) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
    issue_date = datetime.fromisoformat(record['issued_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Manila'))
    display_date = f"{issue_date.strftime('%B')} {issue_date.day}, {issue_date.year}"
    for expected in [display_date, record['branch'], record['number'], record['patient']['name'], record['dentist'], "Valid only with the dentist's signature.", status]:
        assert normalize(expected) in content, 'PDF differs from authoritative prescription'
    for line in record['lines']:
        for field in ['medicine', 'dosage', 'frequency', 'duration', 'instructions']:
            if line.get(field):
                assert normalize(line[field]) in content, 'Prescription line missing from actual PDF'
    if record.get('note'):
        assert normalize(record['note']) in content
    if status == 'VOID':
        assert 'must not be used' in content
    if not record.get('license_no'):
        assert 'License no.' not in content, 'No license may be invented'
    results.append({'file': file, 'pages': len(pdf.pages), 'reference': record['number'], 'status': status, 'contentMatches': True})
(args.evidence / 'PDF_CONTENT_ACCEPTANCE.json').write_text(json.dumps(results, indent=2))
print('PASS actual A4 prescription PDFs: identities, issuer, numbers, status, all clinical lines and signature disclaimer')
