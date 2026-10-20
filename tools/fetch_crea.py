"""Download the CREA food composition tables (alimentinutrizione.it) into data/crea.json.

Fresh and generic foods (pears, courgettes, chickpeas…) have no barcode, so the app offers them
from this table. Polite: one page at a time with a pause. Run: python3 tools/fetch_crea.py
"""
import html, json, re, sys, time, urllib.request

BASE = 'https://www.alimentinutrizione.it/tabelle-nutrizionali/'
UA = {'User-Agent': 'dieta-app (personal diet planner; contact via github.com/rubencarpinteri)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode('utf-8', 'ignore')

def text(page):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', page, flags=re.S)
    t = html.unescape(re.sub(r'<[^>]+>', '|', t))
    return re.sub(r'\s*\|\s*(\|\s*)*', ' | ', t)

def value(t, label):
    m = re.search(re.escape(label) + r' \| [^|]+ \| ([\d.,]+|tr|-)', t)
    if not m or m.group(1) in ('tr', '-'): return 0.0
    return float(m.group(1).replace(',', '.'))

def field(t, label):
    m = re.search(re.escape(label) + r' \| ([^|]+?) \|', t)
    return m.group(1).strip() if m else None

ids = dict(re.findall(r'href="/tabelle-nutrizionali/(\d{6})"[^>]*>\s*([^<]{2,120}?)\s*<', get(BASE + 'ricerca-per-alimento')))
foods = []
for n, (code, name) in enumerate(sorted(ids.items())):
    try:
        t = text(get(BASE + code))
    except Exception as e:
        print('skip', code, e, file=sys.stderr); continue
    # CREA gives saturated fats as % of fatty acids; fatty acids are about 90% of total fat.
    sat = round(value(t, 'Lipidi (g)') * value(t, 'Acidi grassi Saturi (%)') / 100 * 0.9, 2)
    foods.append({
        'code': code, 'name': html.unescape(name).strip().strip('"|'), 'group': field(t, 'Categoria'),
        'edible': field(t, 'Parte Edibile'), 'portion': field(t, 'Porzione'),
        'kcal': value(t, 'Energia (kcal)'), 'protein': value(t, 'Proteine (g)'), 'fat': value(t, 'Lipidi (g)'),
        'satFat': sat, 'carbs': value(t, 'Carboidrati disponibili (g)'), 'sugars': value(t, 'Zuccheri solubili (g)'),
        'fiber': value(t, 'Fibra totale (g)'), 'sodiumMg': value(t, 'Sodio (mg)'),
    })
    if n % 50 == 0: print(n, code, name, file=sys.stderr)
    time.sleep(0.4)
json.dump(foods, open('tools/crea_raw.json', 'w'), ensure_ascii=False, indent=0)
print(len(foods), 'foods')
