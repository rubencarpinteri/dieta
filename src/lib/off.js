// Open Food Facts lookups from the browser.
import { normalizeAdditives } from './additives.js';
import { nutriScore } from './nutriscore.js';

const FIELDS = 'code,product_name,product_name_it,brands,quantity,nutriscore_grade,nutriscore_score,nova_group,additives_tags,labels_tags,nutriments,image_front_small_url,categories_tags';

const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Search by brand, then filter by name words on our side.
 * (The Open Food Facts full-text search does not allow calls from web pages, so brand + name is the reliable option.)
 */
export async function searchProducts(brand, name = '') {
  const url = `https://world.openfoodfacts.org/api/v2/search?${new URLSearchParams({ brands_tags: slug(brand), page_size: '100', sort_by: 'unique_scans_n', fields: FIELDS })}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    res = null;
  }
  if (!res?.ok) throw new Error('La ricerca di Open Food Facts è momentaneamente non disponibile. Riprova più tardi, oppure usa il codice a barre o l\'etichetta.');
  const words = slug(name).split('-').filter(Boolean);
  const products = (await res.json()).products ?? [];
  return products.filter((p) => { const n = slug(`${p.product_name_it ?? ''} ${p.product_name ?? ''}`); return words.every((w) => n.includes(w)); }).slice(0, 25);
}

export async function productByBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  const data = await res.json();
  if (data.status !== 1) throw new Error('Codice a barre non trovato su Open Food Facts.');
  return data.product;
}

// Order matters: the first match wins (e.g. "tonno all'olio" is a protein, not a condiment).
const CATEGORY_HINTS = [
  [/carne|meat|pollo|chicken|tonno|tuna|pesce|fish|uova|eggs|salum|prosciutt|hams|sausage/, 'proteine'],
  [/frutta-secca|nuts|mandorl|almond/, 'frutta_secca'],
  [/biscott|cioccolat|dolc|merendin|crema-spalmabile|spreads/, 'dolci'],
  [/olio|oils|sals|sauce|condiment|pesto|burro|butter|maionese|mayonnaise|tomato|pomodor/, 'condimenti'],
  [/pasta|riso|rice|pane|bread|cracker|cereal|farin|flour|piadin/, 'cereali'],
  [/latte|milk|yogurt|formagg|cheese|dessert/, 'latticini'],
  [/verdur|vegetable/, 'verdure'],
  [/frutta|fruit/, 'frutta'],
];

export function guessCategory(tags = []) {
  const s = tags.join(' ');
  return CATEGORY_HINTS.find(([re]) => re.test(s))?.[1] ?? 'pronti';
}

/** Convert an OFF record to the app's product shape. */
export function fromOff(p, category = guessCategory(p.categories_tags)) {
  const n = p.nutriments ?? {};
  const nutrients = {
    energyKcal: n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : 0),
    protein: n.proteins_100g ?? 0, carbs: n.carbohydrates_100g ?? 0, sugars: n.sugars_100g ?? 0,
    fat: n.fat_100g ?? 0, satFat: n['saturated-fat_100g'] ?? 0, fiber: n.fiber_100g ?? 0, salt: n.salt_100g ?? 0,
  };
  const name = [p.product_name_it || p.product_name, p.brands?.split?.(',')[0] ?? p.brands?.[0]].filter(Boolean).join(' – ');
  return {
    id: `off_${p.code}`, category, name, source: 'openfoodfacts', barcode: p.code, quantity: p.quantity ?? null, nutrients,
    nutriscore: p.nutriscore_score != null ? { points: p.nutriscore_score, grade: p.nutriscore_grade, estimated: false }
      : { ...nutriScore(nutrients, category === 'latticini' && /formagg|cheese/.test(String(p.categories_tags)) ? 'cheese' : 'general'), estimated: true },
    nova: p.nova_group ?? null, additives: normalizeAdditives(p.additives_tags), additivesKnown: p.additives_tags != null,
    organic: (p.labels_tags ?? []).includes('en:organic'), image: p.image_front_small_url ?? null, flags: [],
  };
}

export function manualProduct({ name, category, quantity, ...nutrients }) {
  const nums = Object.fromEntries(Object.entries(nutrients).map(([k, v]) => [k, Number(String(v).replace(',', '.')) || 0]));
  return {
    id: `man_${Date.now().toString(36)}`, category, name, source: 'manuale', barcode: null, quantity: quantity || null, nutrients: nums,
    nutriscore: { ...nutriScore(nums, 'general'), estimated: true }, nova: null, additives: [], additivesKnown: false,
    organic: false, image: null, flags: ['Inserito a mano dall\'etichetta: additivi non valutati.'],
  };
}
