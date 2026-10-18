// Prints the quality report for data/products.json.
import { readFileSync } from 'node:fs';
import { qualityScore } from '../src/lib/scoring.js';
import { ADDITIVES } from '../src/lib/additives.js';
const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)));
const rows = products.map((p) => ({ p, q: qualityScore(p) })).sort((a, b) => (b.q.score ?? -1) - (a.q.score ?? -1));
for (const { p, q } of rows) {
  const add = p.additives.filter((c) => ADDITIVES[c].risk !== 'none').map((c) => `${c.toUpperCase()}(${ADDITIVES[c].risk})`).join(' ');
  console.log([q.score, q.label, p.category, p.name, `NS ${p.nutriscore.grade.toUpperCase()}${p.nutriscore.estimated ? '*' : ''}`, `NOVA ${p.nova ?? '-'}`, Math.round(p.nutrients.energyKcal) + 'kcal', 'P' + p.nutrients.protein, add, p.flags.length ? 'FLAG' : ''].join(' | '));
}
