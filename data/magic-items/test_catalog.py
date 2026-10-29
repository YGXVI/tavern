import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from import_catalog import build, normalize

ROOT = Path(__file__).parent

class CatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads((ROOT/'source-snapshot.json').read_text())
        cls.catalogue = normalize(cls.snapshot)
        cls.temp = tempfile.TemporaryDirectory()
        cls.report = build(ROOT/'source-snapshot.json', cls.temp.name)
        cls.db = sqlite3.connect(Path(cls.temp.name)/'items.sqlite')

    @classmethod
    def tearDownClass(cls):
        cls.db.close()
        cls.temp.cleanup()

    def test_entire_catalogue_not_truncated(self):
        self.assertEqual(len(self.catalogue['items']),934)
        self.assertEqual(self.report['publication_count'],52)
        self.assertEqual(len({i['id'] for i in self.catalogue['items']}),934)
        self.assertEqual(self.db.execute('SELECT count(*) FROM items').fetchone()[0],934)

    def test_bilingual_apostrophes_commas_and_verified_titles(self):
        items={i['source_id']:i for i in self.catalogue['items']}
        self.assertEqual(items[2107]['name_en'],'Akmon, hammer of Purphoros')
        self.assertIn('Heward',items[10836]['name_en'])
        self.assertGreater(len(items[10836]['name_en']),len('Heward'))
        self.assertEqual(items[2423]['name_en'],'Loadstone')
        self.assertNotIn('Магнетит',items[2423]['name_en'])

    def test_sqlite_constraints_and_publication_relationships(self):
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute('SELECT count(*) FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_publications ip WHERE ip.item_id=i.id)').fetchone()[0],0)
        self.db.execute('PRAGMA foreign_keys=ON')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO item_publications VALUES ('missing','missing')")
        self.db.rollback()

    def test_russian_english_search_and_filters(self):
        self.assertGreater(self.db.execute("SELECT count(*) FROM item_search WHERE item_search MATCH 'зелье'").fetchone()[0],0)
        self.assertGreater(self.db.execute("SELECT count(*) FROM item_search WHERE item_search MATCH 'potion'").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM items WHERE rarity='artifact'").fetchone()[0],45)
        self.assertEqual(self.db.execute('SELECT sum(requires_attunement) FROM items').fetchone()[0],554)

    def test_rebuild_is_reproducible(self):
        built=(Path(self.temp.name)/'items.json').read_bytes()
        self.assertEqual(built,(ROOT/'items.json').read_bytes())
        self.assertEqual(self.report,json.loads((ROOT/'provenance.json').read_text()))
        db_rows=self.db.execute('SELECT id,name_ru,name_en,source_url FROM items ORDER BY source_id').fetchall()
        self.assertEqual(db_rows,[(i['id'],i['name_ru'],i['name_en'],i['source_url']) for i in self.catalogue['items']])

    def test_incomplete_metadata_and_duplicate_ids_rejected(self):
        missing=copy.deepcopy(self.snapshot)
        missing['filters'].pop(next(iter(missing['filters'])))
        with self.assertRaises(ValueError): normalize(missing)
        duplicate=copy.deepcopy(self.snapshot)
        duplicate['rows'].append(duplicate['rows'][0])
        with self.assertRaises(ValueError): normalize(duplicate)

    def test_unknown_codes_private_and_wrong_edition_urls_rejected(self):
        for kind in ('unknown','private','edition'):
            bad=copy.deepcopy(self.snapshot)
            row=bad['rows'][0]
            if kind=='unknown':bad['filters'][row['sourceId']]['quality']=['9999']
            elif kind=='private':row['otherLabels'].append('Приватная карточка')
            else:row['url']=row['url'].replace('dnd.su','next.dnd.su')
            with self.subTest(kind=kind),self.assertRaises(ValueError): normalize(bad)

    def test_no_descriptions_images_or_unintended_fields(self):
        for item in self.catalogue['items']:
            self.assertEqual(item['edition'],'5e-2014')
            self.assertEqual(item['content_status'],'metadata_only')
            self.assertFalse({'description','description_html','image','image_url'} & item.keys())

if __name__=='__main__': unittest.main()
