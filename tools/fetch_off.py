"""Fetch full Open Food Facts records for chosen barcodes. Usage: fetch_off.py out.json code1 code2 ..."""
import json, sys, time, urllib.request
FIELDS = ("code,product_name,product_name_it,brands,quantity,nutriscore_grade,nutriscore_score,nova_group,"
          "additives_tags,additives_n,ingredients_text_it,ingredients_text,labels_tags,nutriments,"
          "image_front_small_url,categories_tags,allergens_tags,serving_size")
out = {}
for code in sys.argv[2:]:
    url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={FIELDS}"
    for attempt in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "DietaApp/0.1 (personal use)"}), timeout=30))
            out[code] = d.get("product")
            break
        except Exception as e:
            out[code] = {"error": str(e)}
            time.sleep(3)
    time.sleep(0.7)
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
