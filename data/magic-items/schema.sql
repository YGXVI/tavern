PRAGMA user_version = 1;
CREATE TABLE item_types(code TEXT PRIMARY KEY, name_ru TEXT NOT NULL) STRICT;
CREATE TABLE rarities(code TEXT PRIMARY KEY, name_ru TEXT NOT NULL) STRICT;
CREATE TABLE publications(
  id TEXT PRIMARY KEY, source_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL, source_group TEXT NOT NULL
) STRICT;
CREATE TABLE items(
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL UNIQUE,
  name_ru TEXT NOT NULL CHECK(length(name_ru)>0),
  name_en TEXT NOT NULL CHECK(length(name_en)>0),
  edition TEXT NOT NULL CHECK(edition='5e-2014'),
  item_type TEXT NOT NULL REFERENCES item_types(code),
  rarity TEXT NOT NULL REFERENCES rarities(code),
  requires_attunement INTEGER NOT NULL CHECK(requires_attunement IN (0,1)),
  source_url TEXT NOT NULL UNIQUE,
  catalog_section TEXT NOT NULL CHECK(catalog_section='official'),
  content_status TEXT NOT NULL CHECK(content_status='metadata_only')
) STRICT;
CREATE TABLE item_publications(
  item_id TEXT NOT NULL REFERENCES items(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  PRIMARY KEY(item_id, publication_id)
) STRICT;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE INDEX items_type_rarity ON items(item_type,rarity);
CREATE INDEX items_attunement ON items(requires_attunement);
CREATE INDEX publication_items ON item_publications(publication_id,item_id);
CREATE VIRTUAL TABLE item_search USING fts5(item_id UNINDEXED,name_ru,name_en,tokenize='unicode61 remove_diacritics 2');
