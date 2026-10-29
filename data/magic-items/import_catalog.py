#!/usr/bin/env python3
"""Build a factual dnd.su catalogue offline; never imports descriptions or images."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

TYPE_CODES = {'1':'wondrous_item','2':'potion','3':'ring','4':'scroll','5':'wand','6':'rod','7':'staff','8':'armor','9':'weapon'}
RARITY_CODES = {'1':'uncommon','2':'rare','3':'very_rare','4':'legendary','5':'varies','6':'common','7':'artifact','8':'no_rarity'}
BASE = 'https://dnd.su/items/'


def canonical_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def flatten_dictionary(groups):
    result = {}
    for group in groups.values() if isinstance(groups, dict) else groups:
        entries = group['list']
        for entry in entries.values() if isinstance(entries, dict) else entries:
            key = str(entry['value'])
            if key in result:
                raise ValueError(f'Duplicate dictionary ID {key}')
            result[key] = {'name': entry['title'], 'group': group['title']}
    return result


def normalize(snapshot):
    if snapshot.get('source') != BASE:
        raise ValueError('Expected the 5e14 official catalogue URL')
    if not snapshot.get('retrievedAt'):
        raise ValueError('Missing retrieval timestamp')
    dictionaries = snapshot['dictionaries']
    type_labels = flatten_dictionary(dictionaries['type'])
    rarity_labels = flatten_dictionary(dictionaries['quality'])
    source_labels = flatten_dictionary(dictionaries['source'])
    if set(type_labels) != set(TYPE_CODES) or set(rarity_labels) != set(RARITY_CODES):
        raise ValueError('Source dictionary changed: review mappings before importing')
    filters = snapshot['filters']
    rows = snapshot['rows']
    ids = [str(row['sourceId']) for row in rows]
    if not rows or len(ids) != len(set(ids)) or set(ids) != set(filters):
        raise ValueError('Duplicate/missing item IDs or incomplete filter metadata')
    items = []
    urls = set()
    used_sources = set()
    for row in rows:
        source_id = str(row['sourceId'])
        if any('приват' in str(label).lower() for label in row.get('otherLabels', [])):
            raise ValueError(f'Private card excluded: {source_id}')
        if not re.fullmatch(r'[1-9][0-9]*', source_id):
            raise ValueError('Invalid source ID')
        url = row['url']
        parsed = urlparse(url)
        if (parsed.scheme != 'https' or parsed.netloc != 'dnd.su'
                or not re.fullmatch(r'/items/' + source_id + r'-[^/]+/', parsed.path)
                or parsed.query or parsed.fragment or url in urls):
            raise ValueError(f'Invalid/duplicate 2014 item URL: {source_id}')
        urls.add(url)
        fields = filters[source_id]
        for field in ('type', 'quality', 'attunement'):
            if len(fields[field]) != 1:
                raise ValueError(f'Expected one {field} for {source_id}')
        type_id, rarity_id = str(fields['type'][0]), str(fields['quality'][0])
        attunement_id = str(fields['attunement'][0])
        if type_id not in TYPE_CODES or rarity_id not in RARITY_CODES or attunement_id not in ('1','2'):
            raise ValueError(f'Unknown metadata code for {source_id}')
        name_ru = row['nameRu'].strip()
        if not name_ru:
            raise ValueError(f'Empty name for {source_id}')
        # Commas inside either name are meaningful. Only remove the RU prefix.
        match = re.fullmatch(re.escape(name_ru) + r'\s*,(.*),\s*', row['search'], re.S)
        override = snapshot.get('detail_names', {}).get(source_id)
        if override:
            if override['source_url'] != url or not override.get('name_en', '').strip():
                raise ValueError(f'Invalid verified title: {source_id}')
            name_en = override['name_en'].strip()
        elif match and match[1].strip():
            name_en = match[1].strip()
        else:
            raise ValueError(f'Cannot safely separate bilingual names: {source_id}')
        requires_attunement = attunement_id == '2'
        if bool(row['attunement']) != requires_attunement:
            raise ValueError(f'Conflicting attunement marker: {source_id}')
        if row['type'] != type_labels[type_id]['name']:
            raise ValueError(f'Conflicting type marker: {source_id}')
        source_ids = sorted(set(map(str, fields['source'])), key=int)
        if not source_ids or not set(source_ids).issubset(source_labels):
            raise ValueError(f'Missing/unknown publication: {source_id}')
        if any(source_labels[s]['group'] == 'Homebrew' for s in source_ids):
            raise ValueError(f'Homebrew publication in official export: {source_id}')
        used_sources.update(source_ids)
        items.append({
            'id': f'dndsu:item:{source_id}',
            'source_id': int(source_id),
            'name_ru': name_ru,
            'name_en': name_en,
            'edition': '5e-2014',
            'type': TYPE_CODES[type_id],
            'rarity': RARITY_CODES[rarity_id],
            'requires_attunement': requires_attunement,
            'publication_ids': [f'dndsu:publication:{s}' for s in source_ids],
            'source_url': url,
            'catalog_section': 'official',
            'content_status': 'metadata_only',
        })
    items.sort(key=lambda item: item['source_id'])
    publications = [{'id': f'dndsu:publication:{s}', 'source_id': int(s),
                     'name': source_labels[s]['name'], 'group': source_labels[s]['group']}
                    for s in sorted(used_sources, key=int)]
    item_types = [{'code': TYPE_CODES[s], 'name_ru': type_labels[s]['name']}
                  for s in sorted(TYPE_CODES, key=int)]
    rarities = [{'code': RARITY_CODES[s], 'name_ru': rarity_labels[s]['name']}
               for s in sorted(RARITY_CODES, key=int)]
    return {'schema_version': 1, 'edition': '5e-2014', 'source_url': BASE,
            'retrieved_at': snapshot['retrievedAt'],
            'content_scope': 'Factual metadata only; no descriptions, translations of descriptions, images or private cards.',
            'item_types': item_types, 'rarities': rarities,
            'publications': publications, 'items': items}


def build(snapshot_path, output):
    snapshot_path, output = Path(snapshot_path), Path(output)
    raw = snapshot_path.read_bytes()
    catalogue = normalize(json.loads(raw))
    json_bytes = canonical_bytes(catalogue)
    report = {
        'schema_version': 1, 'source_url': BASE,
        'retrieved_at': catalogue['retrieved_at'],
        'snapshot_sha256': hashlib.sha256(raw).hexdigest(),
        'catalogue_sha256': hashlib.sha256(json_bytes).hexdigest(),
        'item_count': len(catalogue['items']),
        'publication_count': len(catalogue['publications']),
        'types': dict(sorted(Counter(i['type'] for i in catalogue['items']).items())),
        'rarities': dict(sorted(Counter(i['rarity'] for i in catalogue['items']).items())),
        'attunement_required': sum(i['requires_attunement'] for i in catalogue['items']),
        'missing_names': 0, 'missing_publications': 0, 'duplicate_ids': 0,
        'verified_card_titles': len(json.loads(raw).get('detail_names', {})),
        'description_imported': False, 'images_imported': False,
        'permission_for_full_text': 'not_established',
    }
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix='.magic-items-build-') as directory:
        temp = Path(directory)
        (temp/'items.json').write_bytes(json_bytes)
        db = sqlite3.connect(temp/'items.sqlite')
        try:
            db.execute('PRAGMA foreign_keys = ON')
            db.executescript(Path(__file__).with_name('schema.sql').read_text())
            db.executemany('INSERT INTO item_types VALUES (:code,:name_ru)', catalogue['item_types'])
            db.executemany('INSERT INTO rarities VALUES (:code,:name_ru)', catalogue['rarities'])
            db.executemany('INSERT INTO publications VALUES (:id,:source_id,:name,:group)', catalogue['publications'])
            for item in catalogue['items']:
                db.execute('''INSERT INTO items VALUES
                    (:id,:source_id,:name_ru,:name_en,:edition,:type,:rarity,
                     :requires_attunement,:source_url,:catalog_section,:content_status)''', item)
                db.executemany('INSERT INTO item_publications VALUES (?,?)',
                               [(item['id'], p) for p in item['publication_ids']])
                db.execute('INSERT INTO item_search(item_id,name_ru,name_en) VALUES (?,?,?)',
                           (item['id'], item['name_ru'], item['name_en']))
            db.executemany('INSERT INTO metadata VALUES (?,?)',
                           [(k,json.dumps(v,ensure_ascii=False)) for k,v in report.items()])
            db.commit()
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('SQLite integrity check failed')
        finally:
            db.close()
        (temp/'provenance.json').write_bytes(canonical_bytes(report))
        for name in ('items.json','items.sqlite','provenance.json'):
            os.replace(temp/name, output/name)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=Path(__file__).with_name('source-snapshot.json'))
    parser.add_argument('--output', type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    report = build(args.snapshot,args.output)
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
