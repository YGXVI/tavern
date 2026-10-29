#!/usr/bin/env python3
"""Rebuild the metadata-only D&D 5e 2014 spell catalogue offline."""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from urllib.parse import urljoin,urlparse

BASE='https://dnd.su/spells/'
SCHOOLS={'1':'evocation','2':'conjuration','3':'illusion','4':'necromancy','5':'abjuration','6':'enchantment','7':'transmutation','8':'divination'}
DAMAGE={'10':'bludgeoning','11':'slashing','12':'piercing','13':'fire','14':'cold','15':'lightning','16':'poison','17':'acid','18':'thunder','19':'radiant','20':'force','21':'necrotic','22':'psychic'}

def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()

def flatten(groups):
    result={}
    for group_id,group in groups.items() if isinstance(groups,dict) else enumerate(groups):
        entries=group['list']
        for entry in entries.values() if isinstance(entries,dict) else entries:
            key=str(entry['value'])
            if key in result:raise ValueError(f'Duplicate dictionary value {key}')
            result[key]={'name':entry['title'],'group':group['title'],'group_id':str(group_id)}
    return result

def singleton(card,key,allowed):
    values=list(map(str,card[key]))
    if len(values)!=1 or values[0] not in allowed:raise ValueError(f'Invalid {key}: {card["link"]}')
    return values[0]

def normalize(snapshot):
    if snapshot.get('source_url')!=BASE or snapshot.get('edition')!='5e-2014':raise ValueError('Wrong source or edition')
    if not snapshot.get('retrieved_at'):raise ValueError('Missing capture timestamp')
    cards=snapshot['cards'];headers=snapshot['headers'];d=snapshot['dictionaries']
    if not cards or len({c['link'] for c in cards})!=len(cards) or {c['link'] for c in cards}!=set(headers):raise ValueError('Duplicate or incomplete card/header list')
    sources=flatten(d['source']);schools=flatten(d['school']);classes=flatten(d['class']);subclasses=flatten(d['archetype']);casttimes=flatten(d['casttime']);damage=flatten(d['damtype'])
    base_class_ids=set(classes)
    if set(schools)!=set(SCHOOLS):raise ValueError('Unknown school dictionary')
    for class_id,group in d['archetype'].items():
        class_id=str(class_id)
        if class_id in classes and classes[class_id]['name']!=group['title']:raise ValueError('Inconsistent class dictionary')
        classes.setdefault(class_id,{'name':group['title'],'group':'','group_id':''})
    all_classes=set();all_subclasses=set();all_sources=set();all_damage=set();spells=[];ids=set()
    for c in cards:
        match=re.fullmatch(r'/spells/([1-9]\d*)-[^/]+/',c['link'])
        if not match or int(match[1]) in ids:raise ValueError('Invalid/duplicate spell ID')
        sid=int(match[1]);ids.add(sid);url=urljoin(BASE,c['link']);h=headers[c['link']]
        if urlparse(url).netloc!='dnd.su' or h['source_url']!=url:raise ValueError('Wrong card URL')
        if c.get('filter'):raise ValueError('Unrecognized visibility/filter flag')
        if not c.get('title','').strip() or not c.get('title_en','').strip():raise ValueError('Missing bilingual name')
        expected_title=f'{c["title"].strip()} [{c["title_en"].strip()}]'
        if re.sub(r'\s+',' ',h.get('title','')).strip()!=expected_title:raise ValueError('Card title does not match index')
        level=int(singleton(c,'filter_level',set(map(str,range(10)))))
        if c['level'] not in (str(level),'Заговор' if level==0 else ''):raise ValueError('Inconsistent spell level')
        school=singleton(c,'filter_school',schools)
        if c['school']!=schools[school]['name']:raise ValueError('Inconsistent school label')
        concentration=singleton(c,'filter_concentration',{'1','2'})=='2';ritual=singleton(c,'filter_ritual',{'1','2'})=='2'
        tags=c['item_tags'] or {}
        if bool('concentration' in tags)!=concentration or bool('ritual' in tags)!=ritual:raise ValueError('Inconsistent ritual/concentration flags')
        components=c['filter_components'].split('|')
        if components[-1]!='' or len(components)!=4 or not set(components[:3]).issubset({'0','1'}):raise ValueError('Invalid component flags')
        verbal,somatic,material=[x=='1' for x in components[:3]]
        category=singleton(c,'filter_casttime',casttimes)
        relations={key:sorted(set(map(str,c[field])),key=int) for key,field in [('classes','filter_class'),('optional_classes_tce','filter_class_tce'),('subclasses','filter_archetype'),('sources','filter_source'),('damage_types','filter_damtype')]}
        for key,known in [('classes',classes),('optional_classes_tce',classes),('subclasses',subclasses),('sources',sources),('damage_types',damage)]:
            if not set(relations[key]).issubset(known):raise ValueError(f'Unknown {key} reference')
        if not relations['sources'] or any(sources[s]['group']=='Homebrew' for s in relations['sources']):raise ValueError('Missing or homebrew source')
        all_sources.update(relations['sources']);all_subclasses.update(relations['subclasses']);all_classes.update(relations['classes']+relations['optional_classes_tce']);all_damage.update(relations['damage_types'])
        for field in ('casting_time','range','duration','components'):
            if not isinstance(h.get(field),str) or not h[field].strip():raise ValueError(f'Missing header {field}: {sid}')
        material_match=re.search(r'(?:^|,)\s*М\s*\((.*)\)\s*$',h['components'])
        spell={'id':f'dndsu:spell:{sid}','source_id':sid,'name_ru':c['title'].strip(),'name_en':c['title_en'].strip(),'edition':'5e-2014','level':level,'school':SCHOOLS[school],'casting_category':category,'casting_time':h['casting_time'],'range_text':h['range'],'duration_text':h['duration'],'components_text':h['components'],'verbal':verbal,'somatic':somatic,'material':material,'material_text':material_match[1] if material_match else None,'concentration':concentration,'ritual':ritual,'class_ids':[f'dndsu:class:{x}' for x in relations['classes']],'tce_optional_class_ids':[f'dndsu:class:{x}' for x in relations['optional_classes_tce']],'subclass_ids':[f'dndsu:subclass:{x}' for x in relations['subclasses']],'publication_ids':[f'dndsu:publication:{x}' for x in relations['sources']],'damage_types':[DAMAGE[x] for x in relations['damage_types']],'source_url':url,'content_status':'metadata_only'}
        spells.append(spell)
    for subclass in all_subclasses:all_classes.add(subclasses[subclass]['group_id'])
    result={'schema_version':1,'edition':'5e-2014','source_url':BASE,'retrieved_at':snapshot['retrieved_at'],'content_scope':'Factual index and header fields only; no effect descriptions, higher-level text, images or comments.',
        'schools':[{'code':SCHOOLS[x],'name_ru':schools[x]['name']} for x in sorted(SCHOOLS,key=int)],
        'classes':[{'id':f'dndsu:class:{x}','source_id':int(x),'name_ru':classes[x]['name'],'has_spell_list':x in base_class_ids} for x in sorted(all_classes,key=int)],
        'subclasses':[{'id':f'dndsu:subclass:{x}','source_id':int(x),'name_ru':subclasses[x]['name'],'class_id':f'dndsu:class:{subclasses[x]["group_id"]}'} for x in sorted(all_subclasses,key=int)],
        'publications':[{'id':f'dndsu:publication:{x}','source_id':int(x),'name':sources[x]['name'],'group':sources[x]['group']} for x in sorted(all_sources,key=int)],
        'casting_categories':[{'code':x,'name_ru':casttimes[x]['name']} for x in sorted(casttimes)],
        'damage_types':[{'code':DAMAGE[x],'name_ru':damage[x]['name']} for x in sorted(all_damage,key=int)],
        'spells':sorted(spells,key=lambda x:x['source_id'])}
    return result

def build(snapshot_path,output):
    raw=Path(snapshot_path).read_bytes();catalogue=normalize(json.loads(raw));spells=catalogue['spells'];json_bytes=encoded(catalogue);output=Path(output)
    report={'schema_version':1,'source_url':BASE,'retrieved_at':catalogue['retrieved_at'],'snapshot_sha256':hashlib.sha256(raw).hexdigest(),'catalogue_sha256':hashlib.sha256(json_bytes).hexdigest(),'spell_count':len(spells),'school_count':len(catalogue['schools']),'class_count':len(catalogue['classes']),'spell_list_class_count':sum(c['has_spell_list'] for c in catalogue['classes']),'subclass_count':len(catalogue['subclasses']),'publication_count':len(catalogue['publications']),'levels':{str(k):v for k,v in sorted(Counter(s['level'] for s in spells).items())},'schools':dict(sorted(Counter(s['school'] for s in spells).items())),'concentration_count':sum(s['concentration'] for s in spells),'ritual_count':sum(s['ritual'] for s in spells),'tce_optional_class_links':sum(len(s['tce_optional_class_ids']) for s in spells),'missing_headers':0,'duplicate_ids':0,'descriptions_imported':False,'images_imported':False,'permission_for_full_text':'not_established'}
    report['component_header_discrepancies']=[{'spell_id':s['id'],'components_text':s['components_text'],'index_flags':{k:s[k] for k in ('verbal','somatic','material')}} for s in spells if [bool(re.search(r'(?:^|,)\s*'+letter+r'(?=\s*(?:,|\(|$))',s['components_text'])) for letter in 'ВСМ']!=[s['verbal'],s['somatic'],s['material']]]
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent,prefix='.spells-build-') as directory:
        temp=Path(directory);(temp/'spells.json').write_bytes(json_bytes);db=sqlite3.connect(temp/'spells.sqlite')
        try:
            db.execute('PRAGMA foreign_keys=ON');db.executescript(Path(__file__).with_name('schema.sql').read_text())
            for table in ('schools','casting_categories','damage_types'):db.executemany(f'INSERT INTO {table} VALUES (:code,:name_ru)',catalogue[table])
            db.executemany('INSERT INTO classes VALUES (:id,:source_id,:name_ru,:has_spell_list)',catalogue['classes']);db.executemany('INSERT INTO subclasses VALUES (:id,:source_id,:name_ru,:class_id)',catalogue['subclasses']);db.executemany('INSERT INTO publications VALUES (:id,:source_id,:name,:group)',catalogue['publications'])
            for s in spells:
                db.execute('''INSERT INTO spells VALUES (:id,:source_id,:name_ru,:name_en,:edition,:level,:school,:casting_category,:casting_time,:range_text,:duration_text,:components_text,:verbal,:somatic,:material,:material_text,:concentration,:ritual,:source_url,:content_status)''',s)
                for field,kind in [('class_ids','base'),('tce_optional_class_ids','tce_optional')]:db.executemany('INSERT INTO spell_classes VALUES (?,?,?)',[(s['id'],c,kind) for c in s[field]])
                for table,field in [('spell_subclasses','subclass_ids'),('spell_publications','publication_ids'),('spell_damage_types','damage_types')]:db.executemany(f'INSERT INTO {table} VALUES (?,?)',[(s['id'],v) for v in s[field]])
                db.execute('INSERT INTO spell_search(spell_id,name_ru,name_en) VALUES (?,?,?)',(s['id'],s['name_ru'],s['name_en']))
            db.executemany('INSERT INTO metadata VALUES (?,?)',[(k,json.dumps(v,ensure_ascii=False)) for k,v in report.items()]);db.commit()
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('SQLite integrity failure')
        finally:db.close()
        (temp/'provenance.json').write_bytes(encoded(report))
        for name in ('spells.json','spells.sqlite','provenance.json'):os.replace(temp/name,output/name)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--snapshot',type=Path,default=Path(__file__).with_name('source-snapshot.json'));p.add_argument('--output',type=Path,default=Path(__file__).parent);a=p.parse_args();print(json.dumps(build(a.snapshot,a.output),ensure_ascii=False,indent=2))
