#!/usr/bin/env python3
"""Capture factual spell headers; accepts the public list's DOM JSON as input.
Descriptions, comments and images are never stored. No login or /piece/ crawling.
"""
import argparse
import concurrent.futures
import codecs
from http.client import IncompleteRead
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = 'https://dnd.su/spells/'
LABELS = {'Время накладывания':'casting_time','Дистанция':'range','Компоненты':'components','Длительность':'duration'}

class DictionaryParser(HTMLParser):
    def __init__(self): super().__init__(); self.dictionaries={}
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='input' and attrs.get('name') in {'level','class','archetype','school','source','concentration','ritual','components','casttime','damtype'} and attrs.get('data-list'):
            self.dictionaries[attrs['name']]=json.loads(attrs['data-list'])

class HeaderParser(HTMLParser):
    def __init__(self):
        super().__init__();self.in_params=False;self.in_li=False;self.done=False;self.parts=[];self.entries=[];self.title=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs);classes=attrs.get('class','').split()
        if self.done:return
        if attrs.get('data-copy') and re.fullmatch(r'.+ \[.+\]',attrs['data-copy']) and self.title is None:
            self.title=attrs['data-copy']
        if tag=='ul' and 'params' in classes:self.in_params=True
        if self.in_params and tag=='li':
            if 'desc' in classes:self.done=True;self.in_li=False;return
            self.in_li=True;self.parts=[]
    def handle_data(self,text):
        if self.in_params and self.in_li and not self.done:self.parts.append(text)
    def handle_endtag(self,tag):
        if self.done:return
        if self.in_params and self.in_li and tag=='li':
            self.entries.append(re.sub(r'\s+',' ',''.join(self.parts)).strip());self.in_li=False
        if self.in_params and tag=='ul':self.in_params=False
    def result(self):
        result={}
        for entry in self.entries:
            if ':' not in entry:continue
            label,value=entry.split(':',1)
            if label.strip() in LABELS:result[LABELS[label.strip()]]=value.strip()
        if set(result)!=set(LABELS.values()) or not self.title or not self.done:
            raise ValueError('Public card header is incomplete or its markup changed')
        result['title']=self.title
        return result

def parse_list(script,html):
    match=re.fullmatch(r'\s*window\.LIST\s*=\s*(\{.*\});\s*',script,re.S)
    if not match:raise ValueError('Expected the public DOM list JSON, not arbitrary JavaScript')
    data=json.loads(match[1]);cards=data['cards']
    if data.get('category')!='spells' or not cards:raise ValueError('Wrong/empty catalogue')
    dictionaries=DictionaryParser();dictionaries.feed(html)
    if len(dictionaries.dictionaries)!=10:raise ValueError('Incomplete filter dictionaries')
    ids=[int(re.fullmatch(r'/spells/(\d+)-[^/]+/',c['link'])[1]) for c in cards]
    if len(set(ids))!=len(ids):raise ValueError('Duplicate spell IDs')
    return cards,dictionaries.dictionaries

def capture(script_path,html_path,output,interval=.45):
    cards,dictionaries=parse_list(Path(script_path).read_text(),Path(html_path).read_text())
    output=Path(output);cache_path=output.with_name('.header-cache.json')
    cached=json.loads(cache_path.read_text()) if cache_path.exists() else {}
    cache=cached.get('headers',{}) if cached.get('parser_version')==2 else {}
    limiter=threading.Lock();next_start=[0.0]
    def fetch(card):
        link=card['link'];url=urljoin(BASE,link)
        if urlparse(url).netloc!='dnd.su':raise ValueError('Unexpected host')
        if link in cache:return link,cache[link]
        for attempt in range(3):
            with limiter:
                start=max(time.monotonic(),next_start[0]);next_start[0]=start+interval
            time.sleep(max(0,start-time.monotonic()))
            try:
                request=Request(url,headers={'User-Agent':'RasputyeCatalog/1.0 (factual spell headers; https://github.com/YGXVI/tavern)'})
                with urlopen(request,timeout=25) as response:
                    final=urlparse(response.url)
                    if final.netloc!='dnd.su' or not final.path.startswith('/spells/'):
                        raise ValueError('Redirected outside a public spell card')
                    parser=HeaderParser();decoder=codecs.getincrementaldecoder('utf-8')();received=0
                    while not parser.done:
                        chunk=response.read(4096)
                        if not chunk:
                            if received==0:raise ConnectionError('Empty public response')
                            break
                        received+=len(chunk)
                        if received>1000000:raise ValueError('Header exceeds safety bound')
                        parser.feed(decoder.decode(chunk))
                try:header=parser.result()
                except ValueError as error:raise ValueError(f'{link}: {error}; title={parser.title!r}, fields={parser.entries!r}, boundary={parser.done}') from error
                header['source_url']=url
                header['retrieved_at']=datetime.now(timezone.utc).isoformat()
                return link,header
            except HTTPError as error:
                if error.code in (401,403):raise RuntimeError(f'Access restriction {error.code}; stopping, no bypass') from error
                if error.code not in (429,500,502,503,504) or attempt==2:raise
                retry=error.headers.get('Retry-After','')
                time.sleep(min(30,int(retry)) if retry.isdigit() else 2**(attempt+1))
            except (URLError,TimeoutError,ConnectionError,IncompleteRead):
                if attempt==2:raise
                time.sleep(2**(attempt+1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(fetch,card) for card in cards]
        try:
            for completed,future in enumerate(concurrent.futures.as_completed(futures),1):
                link,header=future.result();cache[link]=header
                if completed%20==0 or completed==len(cards):
                    cache_path.write_text(json.dumps({'parser_version':2,'headers':cache},ensure_ascii=False,indent=2)+'\n')
                    print(f'Checked headers: {completed}/{len(cards)}',flush=True)
        except Exception:
            for future in futures:future.cancel()
            cache_path.write_text(json.dumps({'parser_version':2,'headers':cache},ensure_ascii=False,indent=2)+'\n')
            raise
    snapshot={'schema_version':1,'source_url':BASE,'edition':'5e-2014',
              'retrieved_at':datetime.now(timezone.utc).isoformat(),'cards':cards,
              'dictionaries':dictionaries,'headers':{c['link']:cache[c['link']] for c in cards}}
    output.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n')
    print(f'Complete factual snapshot: {len(cards)} spells',flush=True)
    return snapshot

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--list-script',required=True);p.add_argument('--index-html',required=True);p.add_argument('--output',default=str(Path(__file__).with_name('source-snapshot.json')));a=p.parse_args();capture(a.list_script,a.index_html,a.output)
