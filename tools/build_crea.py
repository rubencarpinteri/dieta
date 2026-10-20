"""tools/crea_raw.json (from fetch_crea.py) → data/crea.json, with the app's categories."""
import json, re

CATEGORY = [
    (r'frutta secca|guscio|semi oleag', 'frutta_secca'),
    (r'frutta', 'frutta'),
    (r'verdur|ortagg', 'verdure'),
    (r'legum', 'proteine'),           # chickpeas, lentils, beans: a protein source in the planner
    (r'carn|pesca|pesce|uova|salum', 'proteine'),
    (r'cereal|pane|pasta|riso|prodotti da forno', 'cereali'),
    (r'latte|formagg|yogurt|latticin', 'latticini'),
    (r'oli|grass|condiment|salse', 'condimenti'),
    (r'spezie|erbe|aromi', 'aromi'),
    (r'dolc|zuccher|cioccolat|gelat', 'dolci'),
]
PROCESSED = r"trasformat|conservat|sott'olio|sotto sale|in scatola|affumicat|salame|prosciutto|wurstel|mortadella|insaccat"

raw = json.load(open('tools/crea_raw.json'))
out = []
for f in raw:
    group = (f.get('group') or '').lower()
    if not f['kcal'] and not f['protein'] and not f['carbs']: continue
    if re.search(r'alcol|infanzia|integrator', group): continue
    cat = next((c for pat, c in CATEGORY if re.search(pat, group)), 'pronti')
    out.append({
        'code': f['code'], 'name': f['name'], 'category': cat,
        'fvl': bool(re.search(r'frutta|verdur|ortagg|legum', group)) and cat != 'frutta_secca',
        'processed': bool(re.search(PROCESSED, (group + ' ' + f['name']).lower())),
        'edible': f.get('edible'),
        **{k: f[k] for k in ('kcal', 'protein', 'fat', 'satFat', 'carbs', 'sugars', 'fiber', 'sodiumMg')},
    })
json.dump(out, open('data/crea.json', 'w'), ensure_ascii=False, separators=(',', ':'))
groups = sorted({(f.get('group') or '?') for f in raw})
print(len(out), 'foods;', 'groups:', groups)
