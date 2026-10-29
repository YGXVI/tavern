import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from capture_source import HeaderParser,parse_list
from import_catalog import build,normalize

ROOT=Path(__file__).parent

class HeaderTests(unittest.TestCase):
    def test_fragmented_text_keeps_words_intact_and_ignores_effect(self):
        parser=HeaderParser()
        for fragment in ['<span data-copy="Паук [Spider climb]"></span><ul class="params"><li><strong>Время накладывания:</strong> 1 действие</li><li>Дистанция: Касание</li><li><strong>Компонент','ы:</strong> В, С, М (капля битума и паук)</li><li>Длительность: 1 час</li><li class="subsection desc">НЕ ИМПОРТИРОВАТЬ ОПИСАНИЕ</li></ul>']:
            parser.feed(fragment)
        result=parser.result()
        self.assertEqual(result['components'],'В, С, М (капля битума и паук)')
        self.assertFalse(any('НЕ ИМПОРТИРОВАТЬ' in value for value in result.values()))

    def test_incomplete_header_rejected(self):
        parser=HeaderParser();parser.feed('<ul class="params"><li>Дистанция: 30 футов</li></ul>')
        with self.assertRaises(ValueError):parser.result()

    def test_list_parser_never_executes_javascript(self):
        with self.assertRaises(ValueError):parse_list('alert(1);','')

class CatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot=json.loads((ROOT/'source-snapshot.json').read_text());cls.catalogue=normalize(cls.snapshot)
        cls.temp=tempfile.TemporaryDirectory();cls.report=build(ROOT/'source-snapshot.json',cls.temp.name);cls.db=sqlite3.connect(Path(cls.temp.name)/'spells.sqlite')
    @classmethod
    def tearDownClass(cls):cls.db.close();cls.temp.cleanup()

    def test_complete_corpus_and_relations(self):
        self.assertEqual(len(self.catalogue['spells']),524)
        self.assertEqual(self.db.execute('SELECT count(*) FROM spells').fetchone()[0],524)
        self.assertEqual(self.db.execute('SELECT count(*) FROM spells WHERE level=0').fetchone()[0],46)
        self.assertEqual(self.report['publication_count'],15)
        self.assertEqual(self.report['school_count'],8)
        self.assertEqual(self.report['subclass_count'],61)
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute('SELECT count(*) FROM spells s WHERE NOT EXISTS(SELECT 1 FROM spell_publications p WHERE p.spell_id=s.id)').fetchone()[0],0)

    def test_optional_tce_class_access_remains_separate(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM spell_classes WHERE access='tce_optional'").fetchone()[0],65)
        self.assertEqual(self.db.execute("SELECT count(*) FROM classes WHERE has_spell_list=1").fetchone()[0],9)
        for spell in self.catalogue['spells']:
            self.assertIn('class_ids',spell);self.assertIn('tce_optional_class_ids',spell)

    def test_search_and_filters_work_in_both_languages(self):
        self.assertGreater(self.db.execute("SELECT count(*) FROM spell_search WHERE spell_search MATCH 'огн*'").fetchone()[0],0)
        self.assertGreater(self.db.execute("SELECT count(*) FROM spell_search WHERE spell_search MATCH 'fire*'").fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT sum(concentration),sum(ritual) FROM spells').fetchone(),(234,34))
        self.assertGreater(self.db.execute("SELECT count(*) FROM spells WHERE level=1 AND school='evocation'").fetchone()[0],0)

    def test_specific_header_parameters(self):
        spell=next(s for s in self.catalogue['spells'] if s['source_id']==1)
        self.assertEqual(spell['name_en'],'Hellish rebuke')
        self.assertEqual(spell['casting_category'],'reaction')
        self.assertEqual(spell['range_text'],'60 футов')
        self.assertFalse(spell['material']);self.assertEqual(spell['duration_text'],'Мгновенная')
        spider=next(s for s in self.catalogue['spells'] if s['source_id']==226)
        self.assertTrue(spider['material']);self.assertIn('паук',spider['material_text'])
        jim=next(s for s in self.catalogue['spells'] if s['source_id']==2341)
        self.assertEqual(jim['components_text'],'В, С, А (1 зм)');self.assertTrue(jim['material']);self.assertIsNone(jim['material_text'])
        self.assertEqual([x['spell_id'] for x in self.report['component_header_discrepancies']],['dndsu:spell:2341'])

    def test_rebuild_matches_delivered_json(self):
        self.assertEqual((Path(self.temp.name)/'spells.json').read_bytes(),(ROOT/'spells.json').read_bytes())
        self.assertEqual(self.report,json.loads((ROOT/'provenance.json').read_text()))
        for spell in self.catalogue['spells']:
            self.assertEqual(self.db.execute('SELECT name_ru,name_en,range_text FROM spells WHERE id=?',(spell['id'],)).fetchone(),(spell['name_ru'],spell['name_en'],spell['range_text']))

    def test_missing_headers_duplicate_ids_and_invalid_edition_rejected(self):
        for kind in ('missing','duplicate','edition','school','relation','title'):
            bad=copy.deepcopy(self.snapshot);card=bad['cards'][0]
            if kind=='missing':del bad['headers'][card['link']]
            elif kind=='duplicate':bad['cards'].append(card)
            elif kind=='edition':bad['edition']='5e-2024'
            elif kind=='school':card['filter_school']=[99999]
            elif kind=='title':bad['headers'][card['link']]['title']='Другое [Other]'
            else:card['filter_class']=[99999]
            with self.subTest(kind=kind),self.assertRaises(ValueError):normalize(bad)

    def test_constraints_reject_invalid_relations(self):
        self.db.execute('PRAGMA foreign_keys=ON')
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO spell_classes VALUES('missing','missing','base')")
        self.db.rollback()

    def test_no_effect_descriptions_or_images(self):
        for spell in self.catalogue['spells']:
            self.assertEqual(spell['content_status'],'metadata_only')
            self.assertFalse({'description','description_html','image_url','higher_levels'} & spell.keys())
            self.assertTrue(spell['source_url'].startswith('https://dnd.su/spells/'))

if __name__=='__main__':unittest.main()
