// Checks how close generated plans get to a calorie target: node tools/plan_check.js 1500 130
import { readFileSync } from 'node:fs';
import { generateWeek, dayTotals } from '../src/lib/planner.js';
import { RECIPES } from '../src/lib/recipes.js';
const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)));
const byId = Object.fromEntries(products.map((p) => [p.id, p]));
const kcal = Number(process.argv[2] ?? 1500), protein = Number(process.argv[3] ?? 130);
const targets = { kcal, protein, fat: Math.round(kcal * 0.3 / 9), carbs: 0, fiber: 25 };
const over = [];
for (let seed = 1; seed <= 30; seed++) {
  const plan = generateWeek({ approved: new Set(products.map((p) => p.id)), targets, dayTypes: ['casa', 'volo', 'casa', 'volo', 'casa', 'casa', 'casa'], seed }, byId);
  for (const day of plan.days) {
    const t = dayTotals(day);
    over.push(t.kcal / kcal);
    if (t.kcal > kcal * 1.1 && seed <= 2) console.log(Math.round(t.kcal), Object.values(day.meals).map((m) => `${RECIPES.find((r) => r.id === m.recipeId).id}:${Math.round(m.totals.kcal)}`).join(' '));
  }
}
over.sort((a, b) => a - b);
const pct = (q) => Math.round(over[Math.floor(q * (over.length - 1))] * 100);
console.log(`target ${kcal}: mediana ${pct(0.5)}%, 90° percentile ${pct(0.9)}%, massimo ${pct(1)}%, giorni oltre +10%: ${over.filter((x) => x > 1.1).length}/${over.length}`);
