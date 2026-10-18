// Quick check of the planner from the command line: node tools/plan_demo.js
import { readFileSync } from 'node:fs';
import { generateWeek, dayTotals, supplementAdvice } from '../src/lib/planner.js';
import { dailyTargets } from '../src/lib/targets.js';
import { RECIPES } from '../src/lib/recipes.js';
import { formatQty } from '../src/lib/units.js';
const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)));
const byId = Object.fromEntries(products.map((p) => [p.id, p]));
const profile = { sex: 'M', age: 35, heightCm: 178, weightKg: 85, activity: 'leggero', pace: 0.5 };
const targets = dailyTargets(profile);
console.log(targets);
const plan = generateWeek({ approved: new Set(products.map((p) => p.id)), targets, dayTypes: ['casa', 'volo', 'pernotto', 'casa', 'casa', 'volo', 'casa'], cooking: process.argv[2] ?? 'momento', seed: 42 }, byId);
const avg = { kcal: 0, protein: 0, fiber: 0, carbs: 0, fat: 0 };
for (const [i, day] of plan.days.entries()) {
  const t = dayTotals(day);
  for (const k in avg) avg[k] += t[k] / 7;
  console.log(`\nGiorno ${i + 1} (${day.type}) → ${Math.round(t.kcal)} kcal P${Math.round(t.protein)} C${Math.round(t.carbs)} G${Math.round(t.fat)} fibre ${Math.round(t.fiber)} sale ${t.salt.toFixed(1)}`);
  for (const [meal, m] of Object.entries(day.meals)) {
    if (!m) { console.log('  ', meal, 'NESSUNA RICETTA'); continue; }
    const r = RECIPES.find((x) => x.id === m.recipeId);
    console.log(`  ${meal}: ${r.name}${m.leftover ? ' (avanzo)' : ''} — ${Math.round(m.totals.kcal)} kcal P${Math.round(m.totals.protein)} | ${m.items.map((it) => `${it.p} ${formatQty(it.p, it.g)}`).join(', ')}`);
  }
}
console.log('\nMedia', Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, Math.round(v)])));
console.log(supplementAdvice(avg, targets));
