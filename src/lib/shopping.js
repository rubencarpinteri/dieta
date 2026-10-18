// Shopping list for a week of meals, expressed in packs when the pack size is known.
import { formatQty, unitsFor } from './units.js';

/** Parse "500 g", "1kg", "1000 ml", "2 x 100 g", "6x35 g", "3 piadelle 225g" → grams per pack. */
export function packGrams(quantity) {
  if (!quantity) return null;
  const q = String(quantity).toLowerCase().replace(',', '.');
  const multi = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/.exec(q);
  if (multi) return Number(multi[1]) * Number(multi[2]);
  const m = [...q.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|gr|ml|l)\b/g)].pop();
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'kg' || m[2] === 'l' ? n * 1000 : n;
}

export function shoppingList(plan, productsById) {
  const totals = {};
  for (const day of plan.days) {
    for (const meal of Object.values(day.meals)) {
      if (!meal) continue;
      for (const { p, g } of meal.items) totals[p] = (totals[p] ?? 0) + g;
    }
  }
  return Object.entries(totals)
    .map(([id, grams]) => {
      const product = productsById[id];
      const pack = packGrams(product.quantity);
      const tiny = grams < 30 && ['aromi', 'condimenti'].includes(product.category);
      let qty = tiny ? 'da avere in dispensa' : formatQty(id, grams);
      if (pack && !tiny) {
        const packs = Math.ceil(grams / pack - 0.05);
        qty = `${packs} ${packs === 1 ? 'confezione' : 'confezioni'} da ${product.quantity} — ne usi ${formatQty(id, grams)}`;
      } else if (unitsFor(id).unit && !tiny) {
        qty = formatQty(id, grams);
      }
      return { id, name: product.name, category: product.category, grams, qty };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
