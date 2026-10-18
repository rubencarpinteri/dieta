// Weekly plan generator. Hard rule: a recipe is eligible only if every ingredient is in the person's approved list.
import { RECIPES } from './recipes.js';
import { unitsFor } from './units.js';

export const MEAL_ORDER = ['colazione', 'pranzo', 'spuntino', 'cena'];
export const MEAL_LABEL = { colazione: 'Colazione', pranzo: 'Pranzo', spuntino: 'Spuntino', cena: 'Cena' };

// Share of the daily calories per meal, by fasting protocol.
export const FASTING = {
  nessuno: { label: 'Nessun digiuno', split: { colazione: 0.22, pranzo: 0.34, spuntino: 0.1, cena: 0.34 } },
  '14:10': { label: '14:10 (finestra di 10 ore)', split: { colazione: 0.25, pranzo: 0.37, cena: 0.38 } },
  '16:8': { label: '16:8 (finestra di 8 ore, salta la colazione)', split: { pranzo: 0.45, spuntino: 0.15, cena: 0.4 } },
};

export const DAY_TYPES = {
  casa: { label: 'A casa', portable: [] },
  volo: { label: 'Volo in giornata', portable: ['pranzo'] },
  pernotto: { label: 'Volo con pernotto', portable: ['colazione', 'pranzo', 'spuntino', 'cena'] },
};

// What each person usually eats on board; editable in the profile.
export const DEFAULT_ONBOARD = ['panino_cotto_provola', 'panino_crudo_provola', 'riso_nero_pollo', 'basmati_pollo_soffritto'];

/** Which recipes fit a meal on a given day: on-board lunch uses the person's on-board list, other carried meals any portable recipe. */
function fitsDay(type, meal, onboard) {
  if (!DAY_TYPES[type].portable.includes(meal)) return () => true;
  if (type === 'volo' && meal === 'pranzo' && onboard?.length) return (r) => onboard.includes(r.id);
  return (r) => r.portable;
}

const MAX_TREATS_PER_WEEK = 2;

export function nutrientsOf(items, productsById) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 };
  for (const { p, g } of items) {
    const n = productsById[p].nutrients;
    t.kcal += (n.energyKcal * g) / 100;
    t.protein += (n.protein * g) / 100;
    t.carbs += (n.carbs * g) / 100;
    t.fat += (n.fat * g) / 100;
    t.fiber += ((n.fiber ?? 0) * g) / 100;
    t.salt += ((n.salt ?? 0) * g) / 100;
  }
  return t;
}

export const eligibleRecipes = (approved) => RECIPES.filter((r) => r.ingredients.every((i) => approved.has(i.p)));

const roundTo = (g, step) => Math.round(g / step) * step;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Scale a recipe's ingredients toward a meal's kcal and protein target. */
export function portion(recipe, target, productsById) {
  const items = recipe.ingredients.map((i) => ({ ...i }));
  const per = (i, key) => productsById[i.p].nutrients[key] / 100;
  const total = (key) => items.reduce((s, i) => s + per(i, key === 'kcal' ? 'energyKcal' : key) * i.g, 0);
  const scaleRole = (role, need, key) => {
    const group = items.filter((i) => i.role === role);
    const current = group.reduce((s, i) => s + per(i, key) * i.g, 0);
    if (!group.length || current <= 0) return;
    const f = (current + need) / current;
    for (const i of group) i.g = clamp(i.g * f, i.min, i.max);
  };

  for (let pass = 0; pass < 3; pass++) {
    scaleRole('protein', target.protein - total('protein'), 'protein');
    scaleRole('carb', target.kcal - total('kcal'), 'energyKcal');
    scaleRole('fat', target.kcal - total('kcal'), 'energyKcal');
    // Vegetables are free to grow: fill volume when the meal is still short.
    scaleRole('veg', Math.max(0, target.kcal - total('kcal')), 'energyKcal');
  }
  for (const i of items) {
    if (i.role === 'fixed') continue;
    i.g = clamp(roundTo(i.g, i.step ?? unitsFor(i.p).step), i.min, i.max);
  }
  return items.filter((i) => i.g > 0);
}

// Small seeded RNG so "rigenera" gives a new plan but a saved seed reproduces the same plan.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * @param {object} opts
 * @param {Set<string>} opts.approved  product ids the person may eat
 * @param {object} opts.targets        from dailyTargets()
 * @param {string} opts.fasting        key of FASTING
 * @param {string[]} opts.dayTypes     7 keys of DAY_TYPES
 * @param {'momento'|'prep'} opts.cooking
 */
export function generateWeek({ approved, targets, fasting = 'nessuno', dayTypes, cooking = 'momento', onboard = DEFAULT_ONBOARD, seed = Date.now() }, productsById) {
  const random = rng(seed);
  const pool = eligibleRecipes(approved);
  const split = FASTING[fasting].split;
  const treatsUsed = { n: 0 };
  const days = [];
  const recent = [];

  for (let d = 0; d < 7; d++) {
    const type = dayTypes?.[d] ?? 'casa';
    const meals = {};
    const picks = {};
    for (const meal of MEAL_ORDER) {
      if (!split[meal]) continue;
      const mustCarry = DAY_TYPES[type].portable.includes(meal);
      // Meal prep: reuse yesterday's lunch/dinner on alternate days at home.
      const prev = days[d - 1]?.meals[meal];
      const prevRecipe = prev && RECIPES.find((r) => r.id === prev.recipeId);
      if (cooking === 'prep' && !mustCarry && prevRecipe && prevRecipe.method !== 'nessuna' && (meal === 'pranzo' || meal === 'cena') && d % 2 === 1 && !prev.leftover) {
        meals[meal] = { ...prev, leftover: true };
        continue;
      }
      picks[meal] = pickMeal({ meal, fits: fitsDay(type, meal, onboard), pool, recent, treatsUsed, random, cooking });
    }
    // Too much salt in one day (cured meats, crackers): re-pick the saltiest meal a few times.
    for (let tries = 0; tries < 6; tries++) {
      Object.assign(meals, balanceDay(picks, meals, targets, split, productsById));
      if (dayTotals({ meals }).salt <= MAX_SALT_PER_DAY) break;
      const [meal] = Object.entries(meals).filter(([, m]) => m && !m.leftover).sort(([, a], [, b]) => b.totals.salt - a.totals.salt)[0];
      picks[meal] = pickMeal({ meal, fits: fitsDay(type, meal, onboard), pool, recent, treatsUsed, random, cooking }) ?? picks[meal];
    }
    days.push({ type, meals });
  }
  return { seed, days };
}

const MAX_SALT_PER_DAY = 7;

/** Portion every picked meal, then nudge per-meal targets so the whole day lands on the daily targets. */
function balanceDay(picks, fixedMeals, targets, split, productsById) {
  const meals = {};
  const factor = { kcal: 1, protein: 1 };
  for (let pass = 0; pass < 4; pass++) {
    const sum = { kcal: 0, protein: 0 };
    const fixed = { kcal: 0, protein: 0 };
    for (const meal of Object.keys(split)) {
      const leftover = fixedMeals[meal]?.leftover ? fixedMeals[meal] : null;
      if (leftover) meals[meal] = leftover;
      else if (picks[meal]) {
        const t = { kcal: targets.kcal * factor.kcal, protein: targets.protein * factor.protein };
        meals[meal] = buildMeal(picks[meal], meal, t, split, productsById);
      } else meals[meal] = null;
      if (!meals[meal]) continue;
      const bucket = leftover ? fixed : sum;
      bucket.kcal += meals[meal].totals.kcal;
      bucket.protein += meals[meal].totals.protein;
    }
    // Leftovers are already cooked: the other meals absorb the difference.
    factor.kcal *= clamp((targets.kcal - fixed.kcal) / (sum.kcal || 1), 0.7, 1.3);
    factor.protein *= clamp((targets.protein - fixed.protein) / (sum.protein || 1), 0.7, 1.4);
  }
  return meals;
}

function pickMeal({ meal, fits, pool, recent, treatsUsed, random, cooking }) {
  let options = pool.filter((r) => r.meals.includes(meal) && fits(r));
  // Cooking every day: skip long batch recipes, unless nothing else fits (e.g. the on-board list).
  if (cooking === 'momento' && options.some((r) => !r.batch || r.minutes <= 15)) options = options.filter((r) => !r.batch || r.minutes <= 15);
  const fresh = options.filter((r) => !recent.slice(-4).includes(r.id) && (!r.treat || treatsUsed.n < MAX_TREATS_PER_WEEK));
  const list = fresh.length ? fresh : options;
  if (!list.length) return null;
  const recipe = list[Math.floor(random() * list.length)];
  if (recipe.treat && meal !== 'colazione') treatsUsed.n++;
  recent.push(recipe.id);
  return recipe;
}

export function buildMeal(recipe, meal, targets, split, productsById) {
  const target = { kcal: targets.kcal * split[meal], protein: targets.protein * split[meal] };
  const items = portion(recipe, target, productsById);
  return { recipeId: recipe.id, items, totals: nutrientsOf(items, productsById) };
}

/** Swap a single meal for another eligible recipe. */
export function swapMeal(plan, dayIndex, meal, opts, productsById) {
  const current = plan.days[dayIndex].meals[meal]?.recipeId;
  const fits = fitsDay(plan.days[dayIndex].type, meal, opts.onboard ?? DEFAULT_ONBOARD);
  const options = eligibleRecipes(opts.approved).filter((r) => r.meals.includes(meal) && r.id !== current && fits(r));
  if (!options.length) return plan;
  const recipe = options[Math.floor(Math.random() * options.length)];
  const days = plan.days.map((day, i) => (i !== dayIndex ? day : {
    ...day, meals: { ...day.meals, [meal]: buildMeal(recipe, meal, opts.targets, FASTING[opts.fasting].split, productsById) },
  }));
  return { ...plan, days };
}

export function dayTotals(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 };
  for (const m of Object.values(day.meals)) if (m) for (const k in t) t[k] += m.totals[k];
  return t;
}

/** Supplements suggested when the plan misses a target the approved foods cannot reach. */
export function supplementAdvice(avg, targets) {
  const advice = [];
  const fiberGap = targets.fiber - avg.fiber;
  if (fiberGap > 3) {
    const grams = Math.min(10, Math.max(5, Math.round(fiberGap / 0.8 / 5) * 5));
    advice.push({
      title: 'Fibre',
      text: `Il piano arriva a circa ${Math.round(avg.fiber)} g di fibre al giorno contro ${targets.fiber} g consigliati. Con le verdure che mangi è difficile colmare la differenza: puoi usare la buccia di psillio (psyllium), che trovi in farmacia, parafarmacia e in molti supermercati. Parti da 5 g al giorno sciolti in un bicchiere grande d'acqua, lontano da eventuali farmaci, e se serve sali a ${grams} g. Bevi molta acqua durante la giornata.`,
    });
  }
  if (avg.protein < targets.protein * 0.85) {
    advice.push({ title: 'Proteine', text: `Le proteine medie (${Math.round(avg.protein)} g) sono sotto l'obiettivo di ${targets.protein} g. Puoi aggiungere uno spuntino proteico (dessert proteico) o chiedermi di alzare le porzioni di carne, pesce e uova.` });
  }
  return advice;
}
