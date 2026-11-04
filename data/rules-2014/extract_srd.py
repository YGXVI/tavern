"""Rebuild a page-addressable research corpus from the official CC-BY SRD PDF.

This processes a source artifact; it does not modify the application repository.
Requires pdfplumber. No network calls, OCR, translation, or inferred rule values.
"""
from pathlib import Path
import collections
import hashlib
import json
import re
import textwrap
import pdfplumber

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'sources' / 'srd-5.1-cc.pdf'
URL = 'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf'
ATTRIBUTION = (
    'This work includes material taken from the System Reference Document 5.1 '
    '(“SRD 5.1”) by Wizards of the Coast LLC and available at '
    'https://dnd.wizards.com/resources/systems-reference-document. '
    'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 '
    'International License available at '
    'https://creativecommons.org/licenses/by/4.0/legalcode.'
)
SECTIONS = [
    ('legal', 'Лицензия и атрибуция', 1, 2),
    ('races', 'Расы — варианты SRD', 3, 7),
    ('classes', 'Классы — варианты SRD', 8, 55),
    ('advancement-multiclassing', 'Развитие и мультиклассирование', 56, 57),
    ('personality-backgrounds', 'Мировоззрение, языки, вдохновение, предыстория', 58, 61),
    ('equipment', 'Снаряжение, оружие, доспехи и расходы', 62, 74),
    ('feats', 'Черты — вариант SRD', 75, 75),
    ('ability-scores', 'Характеристики, проверки и спасброски', 76, 83),
    ('adventuring', 'Путешествия, окружение и отдых', 84, 89),
    ('combat', 'Бой', 90, 99),
    ('spellcasting', 'Накладывание заклинаний', 100, 104),
    ('spell-lists', 'Списки заклинаний классов', 105, 113),
    ('spell-descriptions', 'Полные эффекты заклинаний SRD', 114, 194),
    ('traps', 'Ловушки', 195, 198),
    ('diseases', 'Болезни', 199, 200),
    ('madness', 'Безумие', 201, 202),
    ('objects', 'Объекты', 203, 203),
    ('poisons', 'Яды', 204, 205),
    ('magic-items', 'Магические предметы', 206, 253),
    ('monster-rules', 'Как читать характеристики существ', 254, 260),
    ('monsters', 'Бестиарий SRD', 261, 357),
    ('conditions', 'Приложение PH-A: состояния', 358, 359),
    ('pantheons', 'Приложение PH-B: божества исторических пантеонов', 360, 362),
    ('planes', 'Приложение PH-C: планы существования', 363, 365),
    ('miscellaneous-creatures', 'Приложение MM-A: прочие существа', 366, 394),
    ('nonplayer-characters', 'Приложение MM-B: неигровые персонажи', 395, 403),
]
CLASS_STARTS = {
    'barbarian': 8, 'bard': 11, 'cleric': 15, 'druid': 19,
    'fighter': 24, 'monk': 26, 'paladin': 30, 'ranger': 35,
    'rogue': 39, 'sorcerer': 42, 'warlock': 46, 'wizard': 52,
}


def normalize(text):
    # This PDF encodes a single visible hyphen as a three-codepoint sequence.
    return text.replace('\u00ad\u2010\u2011', '-').replace('\u00ad', '')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(name, obj):
    (ROOT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def section_for(number):
    return next(s for s in SECTIONS if s[2] <= number <= s[3])


pages = []
quality = []
with pdfplumber.open(SOURCE) as pdf:
    assert len(pdf.pages) == 403, 'Unexpected source revision/page count'
    for number, page in enumerate(pdf.pages, 1):
        # Content ends above the running footer on all source pages. Preserve both
        # columns together: class tables can span the full width of a page.
        body = page.crop((0, 0, page.width, 740))
        layout = body.extract_text(layout=True, x_density=5.5, y_density=11, x_tolerance=2) or ''
        lines = [normalize(line).rstrip() for line in layout.splitlines()]
        layout = textwrap.dedent('\n'.join(lines)).strip('\n')
        # A second view is useful for search, but is explicitly NOT reading order.
        search_text = re.sub(r'\s+', ' ', layout).strip()
        headings = []
        # Font-size grouping keeps major headings without pretending that a
        # detector can reconstruct the entire semantic hierarchy of a rulebook.
        groups = {}
        for word in body.extract_words(extra_attrs=['size']):
            if word['size'] >= 13:
                key = (round(word['top'] / 4), round(word['size']))
                groups.setdefault(key, []).append(word)
        for group in groups.values():
            group.sort(key=lambda word: word['x0'])
            headings.append(' '.join(normalize(word['text']) for word in group))
        source_chars = collections.Counter(c.lower() for c in normalize(''.join(c['text'] for c in body.chars)) if c.isalnum())
        output_chars = collections.Counter(c.lower() for c in layout if c.isalnum())
        lost = source_chars - output_chars
        added = output_chars - source_chars
        quality.append({'page': number, 'source_alphanumeric_count': source_chars.total(),
                        'output_alphanumeric_count': output_chars.total(),
                        'missing_alphanumeric_count': lost.total(),
                        'added_alphanumeric_count': added.total()})
        section = section_for(number)
        pages.append({
            'id': f'srd51:page:{number:03d}', 'source_page': number,
            'source_url': f'{URL}#page={number}', 'section_id': section[0],
            'major_headings_detected': headings,
            'layout_text': layout, 'search_text': search_text,
        })
        page.close()
        if number % 50 == 0:
            print(f'Extracted {number}/403 pages', flush=True)

source_meta = {
    'id': 'srd-5.1-cc', 'title': 'System Reference Document 5.1',
    'url': URL, 'local_path': 'sources/srd-5.1-cc.pdf',
    'sha256': digest(SOURCE), 'page_count': len(pages),
    'edition': '5e-2014', 'language': 'en',
    'retrieved_on': '2026-10-29', 'date_timezone': 'Asia/Dushanbe',
    'license': 'CC-BY-4.0', 'attribution': ATTRIBUTION,
}
limitations = [
    'Это SRD 5.1, а не полный Player’s Handbook, Dungeon Master’s Guide или официальный выпуск Basic Rules.',
    'Английский текст источника. Русский перевод полного корпуса не выполнялся.',
    'Структура JSON — разделы и страницы, не отдельные нормализованные механики или сущности.',
    'layout_text сохраняет колонки и широкие таблицы; читать как моноширинный текст. search_text пригоден для поиска, но не задаёт порядок чтения колонок.',
    'Переносы строк и слов исходного PDF сохранены; удалены повторяющиеся нижние колонтитулы и нормализованы артефакты дефисов.',
    'Автоматическая проверка сохранности символов не подтверждает семантическую правильность таблиц. Значения правил не следует автоматически вычислять из раскладки.',
    'Каталоги dnd.su в репозитории имеют другое покрытие и собственное происхождение. Они не заменены и не объединены с этим корпусом.',
]


def export(stem, title, selection, description):
    selected = [p for p in pages if p['source_page'] in selection]
    section_ids = {p['section_id'] for p in selected}
    sections = [dict(id=s[0], title_ru=s[1], source_page_start=s[2], source_page_end=s[3],
                     included_pages=[p['source_page'] for p in selected if p['section_id'] == s[0]])
                for s in SECTIONS if s[0] in section_ids]
    obj = {'schema_version': 1, 'id': stem, 'title_ru': title,
           'description_ru': description, 'edition': '5e-2014',
           'source': source_meta, 'is_complete_commercial_book': False,
           'extraction': {'kind': 'page-layout-text', 'tool': 'pdfplumber',
                          'tool_version': pdfplumber.__version__, 'translated': False},
           'limitations_ru': limitations, 'page_count': len(selected),
           'sections': sections, 'class_start_pages': CLASS_STARTS if 'classes' in section_ids else {},
           'pages': selected}
    write_json(f'{stem}.json', obj)
    out = [f'# {title}', '', description, '',
           '**Редакция:** D&D 5e 2014 · **Корпус:** SRD 5.1 · **Язык текста:** английский.', '',
           '**Это тематическая выборка SRD, не полная коммерческая книга и не официальный Basic Rules.**', '',
           f'Источник: [официальный SRD 5.1]({URL}). Страниц в выборке: {len(selected)}.', '',
           ATTRIBUTION, '', '## Как читать', '',
           'Текст каждой страницы помещён в моноширинный блок: две колонки и широкие таблицы сохраняют взаимное расположение. '
           'Колонки читаются сверху вниз: сначала левая, затем правая; широкие таблицы — по строкам. '
           'Страница и ссылка ведут в исходный PDF. Переносы слов могут сохраняться.', '',
           '## Оглавление', '']
    for section in sections:
        out.append(f"- [{section['title_ru']}](#section-{section['id']}) — страницы SRD {section['included_pages'][0]}–{section['included_pages'][-1]}.")
    current = None
    for page in selected:
        if current != page['section_id']:
            current = page['section_id']
            section = section_for(page['source_page'])
            out.extend(['', f'<a id="section-{current}"></a>', '', f'## {section[1]}', ''])
        out.extend([f"### Страница SRD {page['source_page']}", '',
                    f"[Проверить оригинал]({page['source_url']})", '',
                    '```text', page['layout_text'], '```', ''])
    out.extend(['## Ограничения', ''] + [f'- {x}' for x in limitations] + [''])
    (ROOT / f'{stem}.md').write_text('\n'.join(out), encoding='utf-8')
    return {'id': stem, 'title_ru': title, 'page_count': len(selected),
            'markdown': f'{stem}.md', 'json': f'{stem}.json'}


exports = [
    export('srd-5.1', 'SRD 5.1 — полный корпус правил 2014', set(range(1, 404)),
           'Полное извлечение текстового слоя официального SRD 5.1, включая лицензию и приложения.'),
    export('player-rules', 'Правила игрока — выборка SRD 5.1', set(range(3, 195)) | set(range(358, 366)),
           'Расы, классы, развитие, предыстория, снаряжение, общие механики, бой, магия, тексты заклинаний SRD и приложения PH-A–PH-C.'),
    export('dungeon-master-rules', 'Правила мастера — выборка SRD 5.1', set(range(195, 404)),
           'Ловушки, болезни, безумие, объекты, яды, магические предметы, правила существ, бестиарий и приложения. Общие правила боя и проверок находятся также в basic-rules.'),
    export('basic-rules', 'Базовые механики — выборка SRD 5.1', set(range(56, 105)) | {358, 359},
           'Развитие и мультиклассирование, мировоззрение, вдохновение, предыстория, снаряжение, проверки, путешествия, отдых, бой, накладывание заклинаний и состояния. Это тематический набор основных механик, а не конверсия официального издания Basic Rules.'),
]
quality_report = {
    'source_page_count': len(pages), 'all_pages_present': [p['source_page'] for p in pages] == list(range(1, 404)),
    'nonempty_page_count': sum(bool(p['search_text']) for p in pages),
    'blank_pages': [p['source_page'] for p in pages if not p['search_text']],
    'all_nonblank_pages_have_text': all(p['search_text'] for p in pages if p['source_page'] != 2),
    'missing_alphanumeric_total': sum(q['missing_alphanumeric_count'] for q in quality),
    'added_alphanumeric_total': sum(q['added_alphanumeric_count'] for q in quality),
    'character_check': 'Comparison of casefolded alphanumeric multisets against PDF body characters, excluding footer; not a semantic or reading-order check.',
    'pages_with_character_differences': [q for q in quality if q['missing_alphanumeric_count'] or q['added_alphanumeric_count']],
    'visual_spot_check_pages': [11],
    'visual_spot_check_scope': 'Compared source page layout and extraction: full-width Bard progression table must remain intact. Full-corpus visual comparison not performed.',
}
write_json('quality-report.json', quality_report)
write_json('manifest.json', {'schema_version': 1, 'edition': '5e-2014', 'source': source_meta,
                           'exports': exports, 'limitations_ru': limitations,
                           'requested_books': [
                               {'title': 'Player’s Handbook (2014)', 'complete_text_included': False, 'alternative': 'player-rules'},
                               {'title': 'Dungeon Master’s Guide (2014)', 'complete_text_included': False, 'alternative': 'dungeon-master-rules'},
                               {'title': 'Basic Rules (2014 ruleset)', 'complete_text_included': False, 'alternative': 'basic-rules'},
                           ]})
files = [p for p in ROOT.iterdir() if p.is_file() and p.name != 'checksums.json'] + [SOURCE]
write_json('checksums.json', {str(p.relative_to(ROOT)): digest(p) for p in sorted(files)})
print(json.dumps({'exports': exports, 'quality': quality_report}, ensure_ascii=False, indent=2))
