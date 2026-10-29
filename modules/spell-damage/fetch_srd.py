"""Fetch pinned 2014 SRD spell data; build/test never needs network."""
import json,time,concurrent.futures
from pathlib import Path
from urllib.request import urlopen
BASE='https://www.dnd5eapi.co'
def fetch(url):
 for attempt in range(3):
  try:
   with urlopen(BASE+url,timeout=30) as r:return json.load(r)
  except Exception:
   if attempt==2:raise
   time.sleep(2**attempt)
if __name__=='__main__':
 path=Path(__file__).with_name('srd-2014.json')
 index=fetch('/api/2014/spells')
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
  spells=list(pool.map(lambda x:fetch(x['url']),index['results']))
 path.write_text(json.dumps({'source':BASE+'/api/2014/spells','edition':'2014','spells':spells},ensure_ascii=False,indent=2)+'\n')
 print(len(spells))
