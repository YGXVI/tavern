#!/usr/bin/env python3
"""Английский текст заклинаний SRD 5.1 (CC BY 4.0) для справочника (#203).

Читает data/rules-2014/sources/srd-5.1-cc.pdf (страницы описаний заклинаний), режет страницу на две колонки,
собирает абзацы по отступу первой строки и пишет dist/js/data/spells-srd-2014.json:
{ spells: { "<slug SRD>": { "name": "...", "text": ["абзац", ...], "higher": "..." } } }.
Запуск: python3 tools/spells-srd-text.py
"""
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / 'data/rules-2014/sources/srd-5.1-cc.pdf'
OUT = ROOT / 'dist/js/data/spells-srd-2014.json'
FIRST, LAST = 114, 194  # «Spell Descriptions» … конец раздела
LEVEL = re.compile(r'^(\d)(st|nd|rd|th)-level (abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)( \(ritual\))?$', re.I)
CANTRIP = re.compile(r'^(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation) cantrip$', re.I)
HEAD = re.compile(r'^(Casting Time|Range|Components|Duration):')


def norm(s):
    s = re.sub(r'[­‐‑‒]+', '-', s)
    s = re.sub(r'-{2,}', '-', s)
    return s.replace('’', '’').strip()


def lines_of(page):
    out = []
    w, h = page.width, page.height
    for x0, x1 in ((0, w / 2), (w / 2, w)):
        col = page.crop((x0, 0, x1, h))
        rows = col.extract_text_lines(layout=False, strip=True)
        if not rows:
            continue
        base = min(r['x0'] for r in rows)
        for r in rows:
            t = norm(r['text'])
            if not t or t.startswith('System Reference Document'):
                continue
            out.append({'t': t, 'indent': r['x0'] - base > 6})
    return out


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower().replace('’', '').replace("'", '')).strip('-')


def main():
    pdf = pdfplumber.open(PDF)
    lines = []
    for pn in range(FIRST, LAST + 1):
        lines += lines_of(pdf.pages[pn - 1])
    starts = [i for i in range(len(lines) - 1) if LEVEL.match(lines[i + 1]['t']) or CANTRIP.match(lines[i + 1]['t'])]
    spells = {}
    for k, i in enumerate(starts):
        name = lines[i]['t']
        end = starts[k + 1] if k + 1 < len(starts) else len(lines)
        body = lines[i + 2:end]
        # Технический заголовок — до строки Duration включительно (Components может переноситься).
        j = next((n + 1 for n, ln in enumerate(body[:10]) if ln['t'].startswith('Duration:')), 0)
        paras, cur = [], ''
        for ln in body[j:]:
            t = ln['t']
            new = ln['indent'] or t.startswith('At Higher Levels.')
            if new and cur:
                paras.append(cur)
                cur = ''
            if not cur:
                cur = t
            elif cur.endswith('-'):
                cur += t
            else:
                cur += ' ' + t
        if cur:
            paras.append(cur)
        higher = ''
        rest = []
        for p in paras:
            if p.startswith('At Higher Levels.'):
                higher = p[len('At Higher Levels.'):].strip()
            else:
                rest.append(p)
        if name == 'Spell Descriptions':
            continue
        spells[slug(name)] = {'name': name, 'text': rest, 'higher': higher}
    data = {
        'attribution': 'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/legalcode).',
        'source': 'data/rules-2014/sources/srd-5.1-cc.pdf, pp. %d–%d' % (FIRST, LAST),
        'spells': spells,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(len(spells), 'spells →', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
