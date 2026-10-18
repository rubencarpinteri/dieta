"""Search Open Food Facts candidates for the user's branded products."""
import json, sys, time, urllib.parse, urllib.request

QUERIES = [
    ("pan_di_stelle", "pan di stelle biscotti", "barilla"),
    ("tonno_rio_mare", "tonno olio di oliva", "rio-mare"),
    ("zeropiu_balocco", "zeropiu", "balocco"),
    ("misura_avena_cioccolato", "gocce cioccolato fiocchi avena", "misura"),
    ("dolciando_cacao_nocciole", "frollini cacao nocciole", "dolciando"),
    ("mezzi_rigatoni_integrali", "mezzi rigatoni integrali", "de-cecco"),
    ("mutti_datterini", "salsa pronta datterini", "mutti"),
    ("pesto_tigullio_senza_aglio", "pesto genovese senza aglio", "tigullio"),
    ("burro_conad", "burro", "conad"),
    ("mutti_triplo_concentrato", "triplo concentrato pomodoro", "mutti"),
    ("cracker_integrali_mb", "cracker integrali", "mulino-bianco"),
    ("farina_00_eurospin", "farina 00", "eurospin"),
    ("risette_scotti", "risette croccanti riso", "riso-scotti"),
    ("grissini_sesamo_eurospin", "grissini sesamo", "eurospin"),
    ("guanciale_ferrarini", "guanciale", "ferrarini"),
    ("latte_ps_conad", "latte parzialmente scremato", "conad"),
    ("mandorle_conad", "mandorle sgusciate", "conad"),
    ("mayo_calve_fresca", "fresca mayo", "calve"),
    ("nutella", "nutella", "ferrero"),
    ("soffritto_conad", "soffritto", "conad"),
    ("parmigiano_pezzi_italiani", "parmigiano reggiano grattugiato", "pezzi-italiani"),
    ("stelline_barilla", "stelline", "barilla"),
    ("granpiada_roberto", "granpiada olio extravergine", "roberto"),
    ("piadelle_integrali_mb", "piadelle integrali", "mulino-bianco"),
    ("pizza_buitoni_creazione", "creazione salame salsiccia piccante provolone cipolla", "buitoni"),
    ("dessert_proteico_lidl", "dessert proteico cioccolato", "milbona"),
    ("pro_high_milk_pro", "pro high crema dessert cacao", ""),
    ("provola_eurospin", "provola affumicata", "eurospin"),
    ("basmati_integrale_conad", "riso basmati integrale", "conad"),
    ("riso_nero_eurospin", "riso nero pronto", "eurospin"),
    ("wurstel_tobias", "wurstel tobias", ""),
    ("mela_golden_melinda", "mela golden", "melinda"),
    ("banane_chiquita", "banane", "chiquita"),
]
FIELDS = "code,product_name,product_name_it,brands,quantity,nutriscore_grade,nova_group,unique_scans_n,countries_tags"

def search(q, brand):
    query = q + (f' brands:"{brand}"' if brand else "")
    url = "https://search.openfoodfacts.org/search?" + urllib.parse.urlencode(
        {"q": query, "langs": "it", "page_size": 8, "sort_by": "-unique_scans_n", "fields": FIELDS})
    req = urllib.request.Request(url, headers={"User-Agent": "DietaApp/0.1 (personal use)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

out = {}
for key, q, brand in QUERIES:
    try:
        d = search(q, brand)
        out[key] = d.get("hits", [])
        if not out[key] and brand:
            out[key] = search(q, "").get("hits", [])
    except Exception as e:
        out[key] = {"error": str(e)}
    time.sleep(0.5)
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
