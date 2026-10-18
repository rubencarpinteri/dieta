// Builds data/products.json from the user's list: Open Food Facts records + average values for generic items.
// Usage: node tools/build_products.js
import { readFileSync, writeFileSync } from 'node:fs';
import { nutriScore } from '../src/lib/nutriscore.js';
import { normalizeAdditives } from '../src/lib/additives.js';

const root = new URL('..', import.meta.url);
const off = JSON.parse(readFileSync(new URL('data/off_raw.json', root)));

// [id, category, name shown, barcode, overrides/notes]
const BRANDED = [
  ['pan_di_stelle', 'dolci', 'Biscotti Pan di Stelle – Mulino Bianco', '8076809580748'],
  ['tonno_rio_mare', 'proteine', "Tonno all'olio di oliva – Rio Mare", '8004030044005'],
  ['zeropiu_balocco', 'dolci', 'Zeropiù con cioccolato – Balocco (6×35 g)', '2000000150781'],
  ['misura_avena', 'dolci', 'Biscotti gocce di cioccolato e avena – Misura', '8002590081829',
    { salt: 0.79, flags: ['Su Open Food Facts il sale è 7,9 g/100 g: è quasi certamente un errore (10 volte il reale). Ho usato 0,79 g. Da verificare in etichetta.'] }],
  ['dolciando_cacao_nocciole', 'dolci', 'Frollini cacao e nocciole – Dolciando (Eurospin)', '8017596003133'],
  ['mezzi_rigatoni_integrali', 'cereali', 'Mezzi rigatoni integrali – De Cecco', '8001250006271'],
  ['mutti_datterini', 'condimenti', 'Salsa pronta datterini – Mutti', '8005110172052'],
  ['pesto_senza_aglio', 'condimenti', "Gran pesto alla genovese senz'aglio – Tigullio", '80037019'],
  ['burro_conad', 'condimenti', 'Burro – Conad (125 g)', '8003170052772',
    { flags: ['Trovato come "Burro senza lattosio" Conad 125 g: i valori nutrizionali sono uguali al burro normale.'] }],
  ['mutti_triplo_concentrato', 'condimenti', 'Triplo concentrato di pomodoro – Mutti', '8005110140013'],
  ['cracker_integrali', 'cereali', 'Cracker integrali – Mulino Bianco', '8076809516655'],
  ['farina_00', 'cereali', 'Farina 00 – Eurospin', '8017596002617'],
  ['risette', 'cereali', 'Risette 100% riso Bio – Riso Scotti', '8001860355028'],
  ['grissini_sesamo', 'cereali', 'Grissini al sesamo – Eurospin', '8017596010506'],
  ['latte_ps', 'latticini', 'Latte parzialmente scremato – Conad', '8003170014312'],
  ['mandorle', 'frutta_secca', 'Mandorle sgusciate – Conad', '80037507', { kind: 'fats' }],
  ['fresca_mayo', 'condimenti', 'Fresca Mayò – Calvè', '8722700619093',
    { additivesFromIngredients: ['e14xx'] }],
  ['nutella', 'dolci', 'Nutella – Ferrero', '3017620422003'],
  ['soffritto', 'verdure', 'Misto per soffritto – Conad', '8003170016668', { kind: 'general', fvl: 100 }],
  ['stelline', 'cereali', 'Stelline – Barilla', '8076800315271'],
  ['granpiada', 'cereali', "Granpiada all'olio EVO – Roberto", '8003490044785'],
  ['piadelle_integrali', 'cereali', 'Piadelle integrali – Mulino Bianco', '8076809571500'],
  ['dessert_proteico_lidl', 'latticini', 'Dessert proteico cioccolato – Lidl (Milbona)', '4056489216162'],
  ['pro_high_cacao', 'latticini', 'Pro High crema dessert al cacao – Milk Pro', '8034066371714'],
  ['provola', 'latticini', 'Provola affumicata – Eurospin', '8017596101082', { kind: 'cheese', flags: ['Ingredienti non presenti su Open Food Facts: additivi non verificabili.'] }],
  ['basmati_integrale', 'cereali', 'Riso basmati integrale – Conad', '8003170085008'],
  ['wurstel_tobias', 'proteine', 'Wurstel Tobias – Eurospin (2×100 g)', '8017596009029',
    { flags: ['Ingredienti non presenti su Open Food Facts. I würstel contengono quasi sempre nitrito (E250): controlla l\'etichetta, il punteggio potrebbe scendere sotto 50.'] }],
];

// Generic items: average values per 100 g of edible part (CREA tables, USDA where CREA lacks data).
const g = (energyKcal, protein, carbs, sugars, fat, satFat, fiber, salt) => ({ energyKcal, protein, carbs, sugars, fat, satFat, fiber, salt });
const GENERIC = [
  ['banana', 'frutta', 'Banane – Chiquita', g(65, 1.2, 15.4, 15.4, 0.3, 0.1, 1.8, 0), { fvl: 100 }],
  ['mela_golden', 'frutta', 'Mela Golden – Melinda', g(50, 0.3, 12.5, 10, 0.1, 0, 2.0, 0), { fvl: 100 }],
  ['limone', 'frutta', 'Limone', g(11, 0.6, 2.3, 2.3, 0, 0, 1.9, 0), { fvl: 100 }],
  ['finocchio', 'verdure', 'Finocchio', g(9, 1.2, 1.0, 1.0, 0, 0, 2.2, 0.01), { fvl: 100 }],
  ['cipolla', 'verdure', 'Cipolla', g(26, 1.0, 5.7, 5.7, 0.1, 0, 1.1, 0.03), { fvl: 100 }],
  ['insalata', 'verdure', 'Insalata (lattuga)', g(19, 1.8, 2.2, 2.2, 0.4, 0.1, 1.5, 0.02), { fvl: 100 }],
  ['patate', 'verdure', 'Patate', g(85, 2.1, 18, 0.4, 1.0, 0.2, 1.6, 0.02), { fvl: 0, flags: ['Nel calcolo nutrizionale le patate contano come amido, non come verdura.'] }],
  ['aglio', 'aromi', 'Aglio', g(41, 0.9, 8.4, 8.4, 0.6, 0.1, 2.3, 0.01), { fvl: 100 }],
  ['basilico', 'aromi', 'Basilico', g(23, 3.1, 2.6, 0.3, 0.6, 0, 1.6, 0.01), { fvl: 100 }],
  ['prezzemolo', 'aromi', 'Prezzemolo', g(30, 3.7, 1.3, 0.9, 0.6, 0.1, 5.0, 0.05), { fvl: 100 }],
  ['paprika', 'aromi', 'Paprika in polvere', g(282, 14, 54, 10, 13, 2.1, 35, 0.2), { fvl: 0 }],
  ['pepe_nero', 'aromi', 'Pepe nero', g(251, 10, 64, 0.6, 3.3, 1.4, 25, 0.05), { fvl: 0 }],
  ['olio_evo', 'condimenti', "Olio extravergine d'oliva", g(899, 0, 0, 0, 99.9, 15, 0, 0), { kind: 'fats', fvl: 100 }],
  ['sale', 'condimenti', 'Sale', g(0, 0, 0, 0, 0, 0, 0, 100), { additives: [], unrated: true }],
  ['zucchero', 'condimenti', 'Zucchero', g(400, 0, 100, 100, 0, 0, 0, 0), { additives: [], unrated: true }],
  ['pan_grattato', 'cereali', 'Pan grattato', g(351, 10.1, 73, 3.5, 2.5, 0.6, 3.5, 1.5)],
  ['pane_integrale', 'cereali', 'Pane integrale a fette (confezionato)', g(250, 9, 41, 4, 4, 0.5, 7, 1.1),
    { additivesKnown: false, flags: ['Valori medi dei pani integrali a fette confezionati. Quando lo compri, inserisci il codice a barre per avere il dato esatto.'] }],
  ['petto_pollo', 'proteine', 'Petto di pollo', g(100, 23.3, 0, 0, 0.8, 0.2, 0, 0.15)],
  ['braciola_pollo', 'proteine', 'Braciola di pollo (coscia disossata)', g(130, 19, 0, 0, 6, 1.7, 0, 0.2)],
  ['tritato_bovino', 'proteine', 'Tritato di bovino', g(215, 18.5, 0, 0, 15.5, 6.5, 0, 0.17),
    { kind: 'redMeat', additives: [], flags: ['Tritato "normale": circa 15% di grassi.'] }],
  ['uova', 'proteine', 'Uova', g(128, 12.4, 0, 0, 8.7, 3.0, 0, 0.35)],
  ['prosciutto_cotto', 'proteine', 'Prosciutto cotto', g(180, 20, 1, 1, 11, 4, 0, 2.0),
    { additives: ['e250', 'e301'], flags: ['Valori medi. Quasi tutti i cotti contengono nitrito (E250); esistono versioni senza nitriti con punteggio molto più alto.'] }],
  ['prosciutto_crudo_sd', 'proteine', 'Prosciutto crudo San Daniele', g(268, 26.5, 0, 0, 18, 6, 0, 5.5),
    { additives: [], flags: ['Il San Daniele DOP è solo coscia di suino e sale: nessun additivo. Il sale però è molto alto.'] }],
  ['bresaola', 'proteine', 'Bresaola', g(151, 32, 0.4, 0.4, 2.6, 1, 0, 4.2),
    { kind: 'redMeat', additives: ['e250', 'e252', 'e301'], flags: ['La bresaola contiene di solito nitriti/nitrati (E250/E252): controlla la confezione.'] }],
  ['parmigiano_grattugiato', 'latticini', 'Parmigiano Reggiano DOP grattugiato', g(392, 33, 0, 0, 28, 18, 0, 1.6),
    { kind: 'cheese', additives: [], flags: ['Marca "Pezzi Italiani" non trovata: valori medi del Parmigiano Reggiano DOP (senza additivi per disciplinare).'] }],
  ['guanciale', 'proteine', 'Guanciale – Ferrarini', g(661, 10, 0, 0, 69, 25, 0, 4.0),
    { additives: ['e250', 'e252'], flags: ['Il guanciale Ferrarini non è su Open Food Facts: valori di un guanciale stagionato simile. Di solito contiene nitriti/nitrati.'] }],
  ['pizza_buitoni_creazione', 'pronti', 'Pizza Creazione salame, salsiccia piccante, provolone e cipolla – Buitoni', g(250, 10, 28, 3, 10.5, 4.5, 2, 1.3),
    { additivesKnown: false, flags: ['Non trovata su Open Food Facts: valori stimati da pizze surgelate simili e additivi sconosciuti. Fotografa l\'etichetta per un dato preciso.'] }],
  ['riso_nero_pronto', 'cereali', 'Riso nero pronto in 2 minuti – Eurospin', g(150, 3.4, 30, 0.5, 1.8, 0.3, 1.5, 0.3),
    { additivesKnown: false, flags: ['Non trovato su Open Food Facts: valori stimati dai risi precotti in busta. Fotografa l\'etichetta per un dato preciso.'] }],
];

const n100 = (n) => ({
  energyKcal: n['energy-kcal_100g'], protein: n.proteins_100g, carbs: n.carbohydrates_100g, sugars: n.sugars_100g,
  fat: n.fat_100g, satFat: n['saturated-fat_100g'], fiber: n.fiber_100g ?? 0, salt: n.salt_100g,
});

const products = [];
for (const [id, category, name, code, opt = {}] of BRANDED) {
  const p = off[code];
  const nutrients = { ...n100(p.nutriments), ...(opt.salt != null ? { salt: opt.salt } : {}) };
  let ns = p.nutriscore_score != null && opt.salt == null && !opt.kind
    ? { points: p.nutriscore_score, grade: p.nutriscore_grade, estimated: false }
    : { ...nutriScore({ ...nutrients, fvl: opt.fvl ?? 0 }, opt.kind ?? 'general'), estimated: true };
  products.push({
    id, category, name, source: 'openfoodfacts', barcode: code, quantity: p.quantity ?? null,
    nutrients, nutriscore: ns, nova: p.nova_group ?? null,
    additives: [...new Set([...normalizeAdditives(p.additives_tags), ...(opt.additivesFromIngredients ?? [])])],
    additivesKnown: p.additives_tags != null,
    organic: (p.labels_tags ?? []).includes('en:organic'),
    image: p.image_front_small_url ?? null, flags: opt.flags ?? [],
  });
}
for (const [id, category, name, nutrients, opt = {}] of GENERIC) {
  products.push({
    id, category, name, source: 'generico', barcode: null, quantity: null, nutrients,
    nutriscore: { ...nutriScore({ ...nutrients, fvl: opt.fvl ?? 0 }, opt.kind ?? 'general'), estimated: true },
    nova: null, additives: opt.additives ?? [], additivesKnown: opt.additivesKnown ?? (opt.additives != null || category !== 'proteine'),
    organic: false, image: null, flags: opt.flags ?? [], ...(opt.unrated ? { unrated: true } : {}),
  });
}
writeFileSync(new URL('data/products.json', root), JSON.stringify(products, null, 1));
console.log(`${products.length} prodotti scritti in data/products.json`);
