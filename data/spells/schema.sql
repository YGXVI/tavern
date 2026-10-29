PRAGMA user_version=1;
CREATE TABLE schools(code TEXT PRIMARY KEY,name_ru TEXT NOT NULL) STRICT;
CREATE TABLE casting_categories(code TEXT PRIMARY KEY,name_ru TEXT NOT NULL) STRICT;
CREATE TABLE damage_types(code TEXT PRIMARY KEY,name_ru TEXT NOT NULL) STRICT;
CREATE TABLE classes(id TEXT PRIMARY KEY,source_id INTEGER UNIQUE NOT NULL,name_ru TEXT NOT NULL,has_spell_list INTEGER NOT NULL CHECK(has_spell_list IN (0,1))) STRICT;
CREATE TABLE subclasses(id TEXT PRIMARY KEY,source_id INTEGER UNIQUE NOT NULL,name_ru TEXT NOT NULL,class_id TEXT NOT NULL REFERENCES classes(id)) STRICT;
CREATE TABLE publications(id TEXT PRIMARY KEY,source_id INTEGER UNIQUE NOT NULL,name TEXT NOT NULL,source_group TEXT NOT NULL) STRICT;
CREATE TABLE spells(
 id TEXT PRIMARY KEY,source_id INTEGER UNIQUE NOT NULL,name_ru TEXT NOT NULL CHECK(length(name_ru)>0),name_en TEXT NOT NULL CHECK(length(name_en)>0),
 edition TEXT NOT NULL CHECK(edition='5e-2014'),level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 9),school TEXT NOT NULL REFERENCES schools(code),
 casting_category TEXT NOT NULL REFERENCES casting_categories(code),casting_time TEXT NOT NULL,range_text TEXT NOT NULL,duration_text TEXT NOT NULL,components_text TEXT NOT NULL,
 verbal INTEGER NOT NULL CHECK(verbal IN (0,1)),somatic INTEGER NOT NULL CHECK(somatic IN (0,1)),material INTEGER NOT NULL CHECK(material IN (0,1)),material_text TEXT,
 concentration INTEGER NOT NULL CHECK(concentration IN (0,1)),ritual INTEGER NOT NULL CHECK(ritual IN (0,1)),source_url TEXT NOT NULL UNIQUE,
 content_status TEXT NOT NULL CHECK(content_status='metadata_only')
) STRICT;
CREATE TABLE spell_classes(spell_id TEXT NOT NULL REFERENCES spells(id),class_id TEXT NOT NULL REFERENCES classes(id),access TEXT NOT NULL CHECK(access IN ('base','tce_optional')),PRIMARY KEY(spell_id,class_id,access)) STRICT;
CREATE TABLE spell_subclasses(spell_id TEXT NOT NULL REFERENCES spells(id),subclass_id TEXT NOT NULL REFERENCES subclasses(id),PRIMARY KEY(spell_id,subclass_id)) STRICT;
CREATE TABLE spell_publications(spell_id TEXT NOT NULL REFERENCES spells(id),publication_id TEXT NOT NULL REFERENCES publications(id),PRIMARY KEY(spell_id,publication_id)) STRICT;
CREATE TABLE spell_damage_types(spell_id TEXT NOT NULL REFERENCES spells(id),damage_type TEXT NOT NULL REFERENCES damage_types(code),PRIMARY KEY(spell_id,damage_type)) STRICT;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE INDEX spells_level_school ON spells(level,school);
CREATE INDEX spells_flags ON spells(concentration,ritual);
CREATE INDEX spell_classes_lookup ON spell_classes(class_id,access,spell_id);
CREATE INDEX spell_subclasses_lookup ON spell_subclasses(subclass_id,spell_id);
CREATE INDEX spell_sources_lookup ON spell_publications(publication_id,spell_id);
CREATE VIRTUAL TABLE spell_search USING fts5(spell_id UNINDEXED,name_ru,name_en,tokenize='unicode61 remove_diacritics 2');
