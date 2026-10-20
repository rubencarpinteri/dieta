// Fresh and generic foods (pears, courgettes, chickpeas, fish…) from the Italian CREA food composition
// tables: they have no barcode, so they are searched here, offline, instead of on Open Food Facts.
import { nutriScore } from './nutriscore.js';

let table = null;
export async function loadCrea() {
  table ??= fetch('data/crea.json').then((r) => r.json());
  return table;
}

const plain = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Foods whose name has every word typed ("pere", "ceci cotti"), plain fresh/raw ones first. */
export async function searchCrea(query) {
  const words = plain(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const rank = (f) => (/fresc|crud/.test(plain(f.name)) ? 0 : 1) + f.name.split(',').length / 10;
  return (await loadCrea())
    .filter((f) => words.every((w) => plain(f.name).includes(w)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 30);
}

/** A CREA food in the app's product shape (values per 100 g of edible part). */
export function fromCrea(f) {
  const nutrients = {
    energyKcal: f.kcal, protein: f.protein, carbs: f.carbs, sugars: f.sugars, fat: f.fat, satFat: f.satFat,
    fiber: f.fiber, salt: Math.round(f.sodiumMg * 2.5) / 1000,
  };
  return {
    id: `crea_${f.code}`, category: f.category, name: f.name, source: 'CREA', barcode: null, quantity: null, nutrients,
    // Fruit, vegetables and legumes count fully as such in the Nutri-Score.
    nutriscore: { ...nutriScore({ ...nutrients, fvl: f.fvl ? 100 : 0 }, f.category === 'latticini' && /formagg/i.test(f.name) ? 'cheese' : 'general'), estimated: true },
    nova: f.processed ? null : 1, additives: [], additivesKnown: !f.processed, organic: false, image: null,
    flags: f.edible && f.edible !== '100 %' ? [`Valori per 100 g di parte edibile (${f.edible} del peso con scarti).`] : [],
  };
}
