"""Generate the read-only public catalogue from reviewed spans of the local PDF.

Run with Python + pdfplumber 0.11.9. No network or mutation of source corpora.
"""
from pathlib import Path
import hashlib
import json
import re
from extract_columns import read_rows

ROOT = Path(__file__).resolve().parents[2]


def main():
    path = ROOT / 'data/features/manifest.json'
    manifest_bytes = path.read_bytes()
    manifest = json.loads(manifest_bytes)
    source = manifest['source']
    pdf_path = ROOT / 'data/rules-2014' / source['local_path']
    assert hashlib.sha256(pdf_path.read_bytes()).hexdigest() == source['sha256'], 'Source PDF changed; review required.'
    rows = read_rows(pdf_path)
    entries = []
    for record in manifest['entries']:
        lines = []
        for span in record['spans']:
            selected = [r for r in rows if r['page'] == span['page'] and r['col'] == span['column'] and span['top'] <= r['y'] <= span['bottom']]
            assert selected, record['id']
            for row in selected:
                text = row['text']
                h = record['heading']
                if (row['page'], row['col'], row['y']) == (h['page'], h['column'], h['y']):
                    assert text.startswith(h['label']), record['id']
                    text = text[len(h['label']):].lstrip()
                if text:
                    # PDF soft-hyphen/duplicate dash glyphs are extraction artifacts.
                    text = re.sub(r'[-\u00ad\u2010\u2011]{2,}', '-', text).replace('\u00ad', '')
                    lines.append(text)
        text = '\n'.join(lines)
        assert text.strip(), record['id']
        start = re.match(r'(?:At|Starting at|Beginning at|When you reach|Beginning when you reach) (\d+)(?:st|nd|rd|th) level', text)
        level = int(start[1]) if start else None
        # All 22 prerequisite lines in this pinned scope were checked: none wraps.
        prerequisite = re.match(r'Prerequisites?:[ \t]*(.+)', text)
        prerequisite_text = prerequisite[1] if prerequisite else None
        entries.append({
            'id': record['id'], 'edition': '5e-2014', 'kind': record['kind'], 'name': record['name'],
            'text': {'en': text, 'ru': None}, 'scope': record['scope'], 'level': level,
            'prerequisiteText': prerequisite_text, 'actionType': None,
            'source': {'kind': 'srd51', 'documentId': source['id'], 'sha256': source['sha256'],
                       'url': source['url'] + '#page=' + str(record['heading']['page']),
                       'spans': record['spans'], 'license': source['license']},
            'review': {'required': False, 'reasons': []},
        })
    assert len(entries) == manifest['coverage']['entries']
    assert len({e['id'] for e in entries}) == len(entries)
    generator_bytes = Path(__file__).read_bytes()
    reader_bytes = Path(__file__).with_name('extract_columns.py').read_bytes()
    scope_bytes = Path(__file__).with_name('scopes.json').read_bytes()
    result = {'schemaVersion': 1, 'catalogueKind': 'feature', 'edition': '5e-2014',
              'revision': hashlib.sha256(manifest_bytes + generator_bytes + reader_bytes + scope_bytes).hexdigest(),
              'sourceHashes': {'manifest': hashlib.sha256(manifest_bytes).hexdigest(), 'generator': hashlib.sha256(generator_bytes).hexdigest(), 'reader': hashlib.sha256(reader_bytes).hexdigest(), 'scopes': hashlib.sha256(scope_bytes).hexdigest(), 'pdf': source['sha256']},
              'attribution': source['attribution'],
              'scopes': json.loads(scope_bytes),
              'sources': [source['url']], 'coverage': manifest['coverage'],
              'limitations': manifest['limitations'], 'entries': entries}
    (ROOT / 'dist/js/data/features-2014.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'entries': len(entries), 'explicit_levels': sum(e['level'] is not None for e in entries)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
