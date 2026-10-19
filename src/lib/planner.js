// Weekly plan generator. Hard rule: a recipe is eligible only if every ingredient is in the person's approved list.
import { RECIPES } from './recipes.js';
import { unitsFor } from './units.js';

export const MEAL_ORDER = ['colazione', 'pranzo', 'bordo', 'spuntino', 'cena'];
export const MEAL_LABEL = { colazione: 'Colazione', pranzo: 'Pranzo', bordo: 'Pasto a bordo ✈️', spuntino: 'Spuntino', cena: 'Cena' };

// Share of the daily calories per meal, by fasting protocol.
export const FASTING = {
  nessuno: { label: 'Nessun digiuno', split: { colazione: 0.22, pranzo: 0.34, spuntino: 0.1, cena: 0.34 } },
  '14:10': { label: '14:10 (finestra di 10 ore)', split: { colazione: 0.25, pranzo: 0.37, cena: 0.38 } },
  '16:8': { label: '16:8 (finestra di 8 ore, salta la colazione)', split: { pranzo: 0.45, spuntino: 0.15, cena: 0.4 } },
};

export const DAY_TYPES = {
  casa: { label: 'A casa', portable: [] },
  volo: { label: 'Volo in giornata', portable: ['bordo'], crewMeal: true },
  pernotto: { label: 'Volo con pernotto', portable: ['colazione', 'pranzo', 'spuntino', 'cena'] },
};

// On flight days the crew meal is an extra meal: it takes this share of the day and the other meals shrink.
const CREW_MEAL_SHARE = 0.22;

/** Share of the daily calories per meal for a given fasting protocol and day type. */
export function splitFor(fasting, type) {
  const base = FASTING[fasting]?.split ?? FASTING.nessuno.split;
  if (!DAY_TYPES[type]?.crewMeal) return base;
  const split = Object.fromEntries(Object.entries(base).map(([m, f]) => [m, f * (1 - CREW_MEAL_SHARE)]));
  return { ...split, bordo: CREW_MEAL_SHARE };
}

/** Recipes that can fill a meal slot. The crew meal uses lunch/dinner recipes you can carry. */
export function servesMeal(r, meal) {
  if (meal === 'bordo') return r.portable && r.meals.some((m) => m === 'pranzo' || m === 'cena');
  return r.meals.includes(meal);
}

// What each person usually eats on board; editable in the profile.
export const DEFAULT_ONBOARD = ['panino_cotto_provola', 'panino_crudo_provola', 'riso_nero_pollo', 'basmati_pollo_soffritto'];

/** Which recipes fit a meal on a given day: on-board lunch uses the person's on-board list, other carried meals any portable recipe. */
function fitsDay(type, meal, onboard) {
  if (!DAY_TYPES[type].portable.includes(meal)) return () => true;
  if (meal === 'bordo' && onboard?.length) return (r) => onboard.includes(r.id);
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
  // Calories come first: if protein pushed the meal over, shrink carbs, then fats, then protein (down to their minimums).
  for (const role of ['carb', 'fat', 'protein']) {
    const excess = total('kcal') - target.kcal;
    if (excess > 0) scaleRole(role, -excess, 'energyKcal');
  }
  // Round to kitchen units; round down when the meal is already at or over target.
  const over = total('kcal') >= target.kcal;
  for (const i of items) {
    if (i.role === 'fixed') continue;
    const step = i.step ?? unitsFor(i.p).step;
    const rounded = over && i.role !== 'veg' ? Math.floor(i.g / step + 1e-9) * step : roundTo(i.g, step);
    i.g = clamp(rounded, i.min, i.max);
  }
  return items.filter((i) => i.g > 0);
}

/** Calories of a recipe at its smallest sensible portion. */
export function minKcal(recipe, productsById) {
  return recipe.ingredients.reduce((s, i) => s + (productsById[i.p].nutrients.energyKcal * i.min) / 100, 0);
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
  const treatsUsed = { n: 0 };
  const days = [];
  const recent = [];

  const fitsFor = (type, meal) => {
    const day = fitsDay(type, meal, onboard);
    const budget = targets.kcal * splitFor(fasting, type)[meal] * 1.1;
    const fit = (r) => day(r) && minKcal(r, productsById) <= budget;
    fit.loose = day;
    return fit;
  };

  for (let d = 0; d < 7; d++) {
    const type = dayTypes?.[d] ?? 'casa';
    const split = splitFor(fasting, type);
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
      picks[meal] = pickMeal({ meal, fits: fitsFor(type, meal), pool, recent, treatsUsed, random, cooking });
    }
    // Re-pick a meal when the day goes over the calorie target (a recipe whose smallest portion is too big)
    // or has too much salt (cured meats, crackers). Keep the best attempt.
    let best = null;
    for (let tries = 0; tries < 10; tries++) {
      Object.assign(meals, balanceDay(picks, meals, targets, split, productsById));
      const t = dayTotals({ meals });
      const kcalOver = t.kcal > targets.kcal * MAX_KCAL_OVER;
      const saltOver = t.salt > MAX_SALT_PER_DAY;
      const penalty = Math.max(0, t.kcal / targets.kcal - 1) * 10 + Math.max(0, t.salt - MAX_SALT_PER_DAY);
      if (!best || penalty < best.penalty) best = { penalty, meals: { ...meals } };
      if (!kcalOver && !saltOver) break;
      const own = Object.entries(meals).filter(([, m]) => m && !m.leftover);
      const [meal] = kcalOver
        ? own.sort(([ma, a], [mb, b]) => (b.totals.kcal - targets.kcal * split[mb]) - (a.totals.kcal - targets.kcal * split[ma]))[0]
        : own.sort(([, a], [, b]) => b.totals.salt - a.totals.salt)[0];
      picks[meal] = pickMeal({ meal, fits: fitsFor(type, meal), pool, recent, treatsUsed, random, cooking }) ?? picks[meal];
    }
    Object.assign(meals, best.meals);
    days.push({ type, meals });
  }
  return { seed, days, targetKcal: targets.kcal };
}

const MAX_SALT_PER_DAY = 7;
const MAX_KCAL_OVER = 1.05;

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
  let options = pool.filter((r) => servesMeal(r, meal) && fits(r));
  if (!options.length && fits.loose) options = pool.filter((r) => servesMeal(r, meal) && fits.loose(r));
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

/** Portion a recipe for an explicit target, leaving out ingredients the person is not eating. */
function buildFor(recipe, target, productsById, skipped = []) {
  const trimmed = skipped.length ? { ...recipe, ingredients: recipe.ingredients.filter((i) => !skipped.includes(i.p)) } : recipe;
  const items = portion(trimmed, target, productsById);
  return { recipeId: recipe.id, items, skipped, totals: nutrientsOf(items, productsById) };
}

const recipeById = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/**
 * Recompute a day after a change: meals already eaten, eaten out, extras and meals with removed
 * ingredients stay as they are; the remaining meals share what is left of the daily target.
 */
export function rebalanceDay(day, targets, split, productsById) {
  const fixed = { kcal: 0, protein: 0 };
  const flexible = [];
  for (const [meal, m] of Object.entries(day.meals)) {
    if (!m) continue;
    if (m.done || m.external || m.skipped?.length || m.custom || m.leftover) { fixed.kcal += m.totals.kcal; fixed.protein += m.totals.protein; }
    else flexible.push(meal);
  }
  for (const e of day.extras ?? []) { fixed.kcal += e.kcal; fixed.protein += e.protein ?? 0; }
  const share = flexible.reduce((sum, meal) => sum + (split[meal] ?? 0.25), 0);
  const left = { kcal: Math.max(0, targets.kcal - fixed.kcal), protein: Math.max(0, targets.protein - fixed.protein) };
  const meals = { ...day.meals };
  // A few passes: portions are clamped to sensible ranges, so nudge the targets until the day adds up.
  // Portions move in kitchen steps (a pouch of rice, an egg), so a pass can overshoot: keep the pass
  // closest to the calories left, counting going over worse than staying a little under.
  const factor = { kcal: 1, protein: 1 };
  let best = null;
  for (let pass = 0; pass < 6 && flexible.length; pass++) {
    const sum = { kcal: 0, protein: 0 };
    const built = {};
    for (const meal of flexible) {
      const f = (split[meal] ?? 0.25) / share;
      built[meal] = buildFor(recipeById[day.meals[meal].recipeId], { kcal: left.kcal * f * factor.kcal, protein: left.protein * f * factor.protein }, productsById);
      sum.kcal += built[meal].totals.kcal;
      sum.protein += built[meal].totals.protein;
    }
    const miss = sum.kcal > left.kcal ? (sum.kcal - left.kcal) * 2 : left.kcal - sum.kcal;
    if (!best || miss < best.miss) best = { miss, built };
    factor.kcal *= clamp(left.kcal / (sum.kcal || 1), 0.7, 1.4);
    // Protein never pushes calories: it can only grow while the calories are not over.
    factor.protein = sum.kcal > left.kcal ? 1 : Math.min(1.3, factor.protein * clamp(left.protein / (sum.protein || 1), 0.8, 1.2));
  }
  if (best) Object.assign(meals, best.built);
  return { ...day, meals };
}

/**
 * Recipes that could replace a meal, portioned for that slot.
 * filter.keep: products the new dish must contain; filter.remove: products it must not contain.
 * Dishes that keep only some of the wanted products are returned too, marked with `kept`.
 */
export function alternatives(plan, dayIndex, meal, opts, productsById, filter = {}) {
  const { keep = [], remove = [] } = typeof filter === 'string' ? { remove: [filter] } : filter ?? {};
  const day = plan.days[dayIndex];
  const split = splitFor(opts.fasting, day.type);
  const fits = fitsDay(day.type, meal, opts.onboard ?? DEFAULT_ONBOARD);
  const target = { kcal: opts.targets.kcal * (split[meal] ?? 0.25), protein: opts.targets.protein * (split[meal] ?? 0.25) };
  return eligibleRecipes(opts.approved)
    .filter((r) => servesMeal(r, meal) && fits(r) && !r.ingredients.some((i) => remove.includes(i.p)))
    .map((r) => ({
      recipe: r,
      meal: buildFor(r, target, productsById),
      fitsBudget: minKcal(r, productsById) <= target.kcal * 1.1,
      kept: keep.filter((p) => r.ingredients.some((i) => i.p === p)).length,
    }))
    .filter((a) => !keep.length || a.kept > 0)
    .sort((a, b) => b.kept - a.kept || b.fitsBudget - a.fitsBudget || Math.abs(a.meal.totals.kcal - target.kcal) - Math.abs(b.meal.totals.kcal - target.kcal));
}

/** Apply a change to one day and rebalance it. `change(day)` returns the changed day. */
export function editDay(plan, dayIndex, change, opts, productsById) {
  const days = plan.days.map((day, i) => {
    if (i !== dayIndex) return day;
    const changed = change(day);
    return rebalanceDay(changed, opts.targets, splitFor(opts.fasting, changed.type), productsById);
  });
  return { ...plan, days };
}

/**
 * Switch a day between "a casa" and "volo": keep every meal that still fits, replace only the
 * ones that must change (e.g. lunch on a flight day). Switching back restores the previous version.
 */
export function changeDayType(plan, dayIndex, type, opts, productsById) {
  const day = plan.days[dayIndex];
  if (day.type === type) return plan;
  const saved = { ...(day.saved ?? {}), [day.type]: day.meals };
  const kept = Object.fromEntries(Object.entries(day.meals).filter(([, m]) => m?.done || m?.external));
  const crew = DAY_TYPES[type].crewMeal;
  let meals;
  if (saved[type] && (!crew || saved[type].bordo)) {
    // Restore what this day looked like with that type; meals eaten since stay as they are.
    meals = { ...saved[type], ...kept };
  } else {
    meals = { ...day.meals };
    if (!crew && !meals.bordo?.done && !meals.bordo?.external) delete meals.bordo;
    const typed = { ...plan, days: plan.days.map((d, i) => (i === dayIndex ? { ...d, type, meals } : d)) };
    for (const meal of Object.keys(splitFor(opts.fasting, type))) {
      const m = meals[meal];
      if (m && (m.done || m.external || fitsDay(type, meal, opts.onboard ?? DEFAULT_ONBOARD)(recipeById[m.recipeId]))) continue;
      const list = alternatives(typed, dayIndex, meal, opts, productsById);
      // Cooking every day: avoid long batch recipes (e.g. brown basmati) when something quicker fits.
      const best = list.find((a) => opts.cooking !== 'momento' || !a.recipe.batch || a.recipe.minutes <= 15) ?? list[0];
      if (best) meals[meal] = best.meal;
    }
  }
  const next = { ...day, type, meals, saved };
  const days = plan.days.map((d, i) => (i === dayIndex ? rebalanceDay(next, opts.targets, splitFor(opts.fasting, type), productsById) : d));
  return { ...plan, days };
}

export const setMeal = (meal, value) => (day) => ({ ...day, meals: { ...day.meals, [meal]: value } });

/** Strike or restore an ingredient of a meal (only what is actually eaten is counted). */
export const toggleSkip = (meal, productId, productsById) => (day) => {
  const m = day.meals[meal];
  const skipped = m.skipped?.includes(productId) ? m.skipped.filter((x) => x !== productId) : [...(m.skipped ?? []), productId];
  const eaten = m.items.filter((i) => !skipped.includes(i.p));
  return setMeal(meal, { ...m, skipped, totals: nutrientsOf(eaten, productsById) })(day);
};

// ── Missing ingredients: swap with something similar, or make up with the rest of the dish ──

/** What a product mainly brings: protein, carb, fat, veg or other (spices, salt…). */
export function productRole(product) {
  if (['aromi'].includes(product.category) || product.unrated) return 'other';
  const n = product.nutrients;
  const kcal = n.protein * 4 + n.carbs * 4 + n.fat * 9;
  // Potatoes are filed with vegetables but in a dish they are the starch (swap them with bread or crackers).
  if (product.category === 'verdure') return n.energyKcal >= 50 && (n.carbs * 4) / kcal >= 0.6 ? 'carb' : 'veg';
  if (!kcal) return 'other';
  const proteinShare = (n.protein * 4) / kcal;
  // Tuna in oil, cheeses and cured meats get many calories from fat but are used as the protein of a dish.
  if (proteinShare >= 0.35 || (['proteine', 'latticini'].includes(product.category) && proteinShare >= 0.2)) return 'protein';
  if ((n.fat * 9) / kcal >= 0.6) return 'fat';
  if ((n.carbs * 4) / kcal >= 0.5) return 'carb';
  return 'other';
}

const ROLE_LABEL = { protein: 'proteine', carb: 'carboidrati', fat: 'grassi', veg: 'verdure' };
export const roleLabel = (role) => ROLE_LABEL[role] ?? '';

/**
 * Products from the approved list that can stand in for a missing one, with the grams that give the
 * same protein (for protein foods), the same calories (carbs, fats) or the same weight (vegetables).
 */
// Products seen in at least one recipe for each meal: a sweet pudding is not offered in place of chicken at lunch.
const usedFor = (() => {
  const map = {};
  for (const r of RECIPES) for (const m of r.meals) for (const i of r.ingredients) (map[i.p] ??= new Set()).add(m);
  return map;
})();
// Products only ever used as a small, fixed part of a dish (sauce, flour) are not offered as a main swap.
const mainSomewhere = new Set(RECIPES.flatMap((r) => r.ingredients.filter((i) => i.role !== 'fixed').map((i) => i.p)));
const NO_SWAP = new Set(['pan_grattato']); // only a coating

export function substitutes(mealObj, productId, approved, productsById, meal = null) {
  const item = mealObj.items.find((i) => i.p === productId);
  const old = productsById[productId];
  const role = productRole(old);
  if (!item || role === 'other') return { role, list: [] };
  const inMeal = new Set(mealObj.items.map((i) => i.p));
  const oldN = old.nutrients;
  const slots = meal === 'bordo' ? ['pranzo', 'cena'] : meal ? [meal] : null;
  // Products added by hand are not in any recipe: offer them everywhere.
  const known = (p) => Boolean(usedFor[p.id]);
  const fitsSlot = (p) => !known(p) || ((!slots || slots.some((m) => usedFor[p.id].has(m))) && mainSomewhere.has(p.id) && !NO_SWAP.has(p.id));
  const list = [...approved].map((id) => productsById[id]).filter((p) => p && !inMeal.has(p.id) && productRole(p) === role && fitsSlot(p))
    .map((p) => {
      const n = p.nutrients;
      let g = role === 'protein' ? (item.g * oldN.protein) / n.protein : role === 'veg' ? item.g : (item.g * oldN.energyKcal) / n.energyKcal;
      const step = unitsFor(p.id).step;
      g = Math.max(step, Math.round(g / step) * step);
      const d = (k) => ((n[k] ?? 0) * g - (oldN[k] ?? 0) * item.g) / 100;
      const delta = { kcal: d('energyKcal'), protein: d('protein'), carbs: d('carbs'), fat: d('fat'), fiber: d('fiber') };
      return { product: p, g, delta };
    })
    // Skip swaps that would add far more calories than the original (e.g. 100 g of parmesan for chicken).
    .filter((x) => x.g <= item.g * 4 && x.delta.kcal <= Math.max(120, (oldN.energyKcal * item.g) / 100 * 0.8))
    .sort((a, b) => Math.abs(a.delta.kcal) + Math.abs(a.delta.protein) * 8 - (Math.abs(b.delta.kcal) + Math.abs(b.delta.protein) * 8));
  return { role, list: list.slice(0, 8) };
}

export const withTotals = (m, productsById) => ({ ...m, totals: nutrientsOf(m.items.filter((i) => !(m.skipped ?? []).includes(i.p)), productsById) });

/** Put `newId` (grams `g`) in place of `oldId` in a meal. */
export const substitute = (meal, oldId, newId, g, productsById) => (day) => {
  const m = day.meals[meal];
  const items = m.items.map((i) => (i.p === oldId ? { ...i, p: newId, g, replaces: oldId, originalG: i.g } : i));
  const skipped = (m.skipped ?? []).filter((x) => x !== oldId);
  return setMeal(meal, withTotals({ ...m, items, skipped, custom: true }, productsById))(day);
};

/** Undo a substitution: the original ingredient comes back. */
export const revertSubstitute = (meal, newId, productsById) => (day) => {
  const m = day.meals[meal];
  const items = m.items.map((i) => (i.p === newId && i.replaces ? (({ replaces, originalG, ...rest }) => ({ ...rest, p: replaces, g: originalG }))(i) : i));
  const custom = items.some((i) => i.replaces) || !!m.boosted;
  return setMeal(meal, withTotals({ ...m, items, custom }, productsById))(day);
};

/** How the meal would change if the rest of the dish made up for the removed ingredients. */
export function compensation(mealObj, productsById) {
  const skipped = mealObj.skipped ?? [];
  const full = nutrientsOf(mealObj.items, productsById);
  const eatenItems = mealObj.items.filter((i) => !skipped.includes(i.p));
  const eaten = nutrientsOf(eatenItems, productsById);
  // Grow the main foods of the dish (not oil, butter or seasonings); vegetables only if nothing else is left.
  const main = (i) => i.role !== 'fixed' && ['carb', 'protein'].includes(productRole(productsById[i.p]));
  const veg = (i) => i.role !== 'fixed' && productRole(productsById[i.p]) === 'veg';
  const grows = eatenItems.some(main) ? main : veg;
  const flexible = eatenItems.filter(grows);
  const flexKcal = nutrientsOf(flexible, productsById).kcal;
  // Nothing worth making up for (e.g. only the salad is missing).
  if (!skipped.length || flexKcal <= 0 || full.kcal - eaten.kcal < 60) return null;
  const factor = Math.min(2.5, 1 + (full.kcal - eaten.kcal) / flexKcal);
  // Never beyond a sensible portion: at most 25% over the recipe's largest portion
  // (e.g. pasta tops at 150 g). Calories that do not fit simply stay as a bigger deficit.
  const cap = (i) => Math.max(i.g, (i.max ?? i.g) * 1.25);
  const scaled = (round) => mealObj.items.map((i) => {
    if (skipped.includes(i.p) || !grows(i)) return i;
    const step = unitsFor(i.p).fine ?? i.step ?? unitsFor(i.p).step;
    const g = Math.min(cap(i), Math.max(step, round((i.g * factor) / step) * step));
    return { ...i, g: Math.floor(g / step + 1e-9) * step || step, boostedFrom: i.g };
  });
  // Round to kitchen units, but not so far up that the dish ends with many more calories than before.
  let items = scaled(Math.round);
  if (nutrientsOf(items.filter((i) => !skipped.includes(i.p)), productsById).kcal > full.kcal * 1.08) items = scaled(Math.floor);
  const after = nutrientsOf(items.filter((i) => !skipped.includes(i.p)), productsById);
  if (items.every((i) => i.boostedFrom == null || i.boostedFrom === i.g)) return null;
  return { items, before: full, after, capped: after.kcal < full.kcal * 0.9 };
}

export const compensate = (meal, productsById) => (day) => {
  const m = day.meals[meal];
  const c = compensation(m, productsById);
  if (!c) return day;
  const { undoneBoost, ...rest } = m;
  return setMeal(meal, withTotals({ ...rest, items: c.items, boosted: true, custom: true }, productsById))(day);
};

export const undoCompensate = (meal, productsById) => (day) => {
  const m = day.meals[meal];
  const items = m.items.map((i) => (i.boostedFrom != null ? (({ boostedFrom, ...rest }) => ({ ...rest, g: boostedFrom }))(i) : i));
  // Keep the increased portions so the undo can itself be undone.
  return setMeal(meal, withTotals({ ...m, items, boosted: false, undoneBoost: m.items, custom: items.some((i) => i.replaces) || (m.skipped ?? []).length > 0 }, productsById))(day);
};

export const redoCompensate = (meal, productsById) => (day) => {
  const m = day.meals[meal];
  if (!m.undoneBoost) return day;
  const { undoneBoost, ...rest } = m;
  return setMeal(meal, withTotals({ ...rest, items: undoneBoost, boosted: true, custom: true }, productsById))(day);
};

/** Add a product from the approved list to a meal (or more of one already in it). */
export const addIngredient = (meal, productId, g, productsById) => (day) => {
  const m = day.meals[meal];
  const existing = m.items.find((i) => i.p === productId);
  const items = existing
    ? m.items.map((i) => (i.p === productId ? { ...i, g: i.g + g, addedG: (i.addedG ?? 0) + g } : i))
    : [...m.items, { p: productId, g, role: 'fixed', min: g, max: g, added: true }];
  const skipped = (m.skipped ?? []).filter((x) => x !== productId);
  return setMeal(meal, withTotals({ ...m, items, skipped, custom: true }, productsById))(day);
};

/** Undo an addition: remove the added product, or the extra grams added to one already there. */
export const removeAdded = (meal, productId, productsById) => (day) => {
  const m = day.meals[meal];
  const items = m.items
    .filter((i) => !(i.p === productId && i.added))
    .map((i) => (i.p === productId && i.addedG ? (({ addedG, ...rest }) => ({ ...rest, g: i.g - addedG }))(i) : i));
  return setMeal(meal, withTotals({ ...m, items }, productsById))(day);
};

/** A meal as eaten (ingredients removed are left out), ready to be saved under a name. */
export function snapshotMeal(m) {
  const skipped = m.skipped ?? [];
  return {
    recipeId: m.recipeId,
    items: m.items.filter((i) => !skipped.includes(i.p) && i.g > 0)
      .map(({ p, g, role, min, max, step }) => ({ p, g, role: role ?? 'fixed', min: Math.min(min ?? g, g), max: Math.max(max ?? g, g), ...(step ? { step } : {}) })),
  };
}

/** Put a saved meal in a slot, with its saved amounts. */
export const applySaved = (meal, saved, productsById) => (day) =>
  setMeal(meal, withTotals({ recipeId: saved.recipeId, items: saved.items.map((i) => ({ ...i })), skipped: [], custom: true, savedId: saved.id, savedName: saved.name }, productsById))(day);

/** Set how much of an ingredient you eat; the planned amount is kept to go back to it. */
export const setQuantity = (meal, productId, g, productsById) => (day) => {
  const m = day.meals[meal];
  const items = m.items.map((i) => {
    if (i.p !== productId) return i;
    const from = i.editedFrom ?? i.g;
    const { editedFrom, ...rest } = i;
    return g === from ? { ...rest, g } : { ...rest, g, editedFrom: from };
  });
  const skipped = (m.skipped ?? []).filter((x) => x !== productId);
  const custom = items.some((i) => i.editedFrom != null || i.added || i.addedG || i.replaces) || skipped.length > 0 || !!m.boosted;
  return setMeal(meal, withTotals({ ...m, items, skipped, custom }, productsById))(day);
};

// ── Rebalancing after a changed meal ──

const MACROS = ['protein', 'carbs', 'fat', 'fiber'];
// Below these amounts a missing macro is not worth a suggestion.
export const DEFICIT_THRESHOLD = { protein: 15, carbs: 40, fat: 15, fiber: 5 };

/** What a meal as planned would have given, minus what is actually eaten. */
export function mealDeficit(m, productsById) {
  if (!m) return null;
  let planned;
  if (m.external) planned = m.replaced?.totals;
  else {
    const original = m.items.map((i) => ({ p: i.replaces ?? i.p, g: i.replaces ? i.originalG : i.boostedFrom ?? i.g }));
    planned = nutrientsOf(original, productsById);
  }
  if (!planned) return null;
  return Object.fromEntries(MACROS.map((k) => [k, Math.max(0, (planned[k] ?? 0) - (m.totals[k] ?? 0))]));
}

/**
 * Where to suggest a rebalance today: the next main meal not eaten yet, after meals that lost a
 * meaningful amount of protein, carbs, fat or fibre. Returns { meal, deficit, from } or null.
 */
export function rebalanceSuggestion(day, productsById, targets) {
  const order = MEAL_ORDER.filter((m) => day.meals[m]);
  const changed = order.filter((m) => {
    const x = day.meals[m];
    return x && (x.skipped?.length || x.custom || x.external);
  });
  if (!changed.length) return null;
  const deficit = Object.fromEntries(MACROS.map((k) => [k, 0]));
  for (const m of changed) { const d = mealDeficit(day.meals[m], productsById); if (d) for (const k of MACROS) deficit[k] += d[k]; }
  // Only what the rest of the day has not already made up (other meals grow automatically).
  const totals = dayTotals(day);
  const gap = Object.fromEntries(MACROS.map((k) => [k, Math.max(0, (targets?.[k] ?? 0) - (totals[k] ?? 0))]));
  const missing = MACROS.filter((k) => deficit[k] >= DEFICIT_THRESHOLD[k] && (!targets || gap[k] >= DEFICIT_THRESHOLD[k] / 2));
  if (!missing.length) return null;
  const last = Math.max(...changed.map((m) => order.indexOf(m)));
  const open = (m) => { const x = day.meals[m]; return x && !x.done && !x.external && !changed.includes(m); };
  const after = order.slice(last + 1).filter(open);
  const target = after.find((m) => m !== 'spuntino' && m !== 'colazione') ?? after[0];
  if (!target) return null;
  return { meal: target, deficit, gap, missing, from: changed };
}

/** The same dish with more protein and the same calories (less of the rest). */
export function moreProtein(m, extra, productsById) {
  const recipe = recipeById[m.recipeId];
  if (!recipe) return null;
  const built = buildFor(recipe, { kcal: m.totals.kcal, protein: m.totals.protein + extra }, productsById);
  const gain = built.totals.protein - m.totals.protein;
  return gain >= 5 ? { ...built, gain } : null;
}

const PER_KCAL = { protein: 'protein', carbs: 'carbs', fat: 'fat', fiber: 'fiber' };

/** Another dish for this meal richer in the missing macro (per calorie) than the current one. */
export function richerAlternative(plan, dayIndex, meal, opts, productsById, macro) {
  const cur = plan.days[dayIndex].meals[meal];
  const density = (t) => (t[PER_KCAL[macro]] ?? 0) / Math.max(1, t.kcal);
  return alternatives(plan, dayIndex, meal, opts, productsById)
    .filter((a) => a.recipe.id !== cur.recipeId && a.fitsBudget && a.meal.totals[macro] >= cur.totals[macro] + (macro === 'fiber' ? 2 : 5))
    .sort((a, b) => density(b.meal.totals) - density(a.meal.totals))[0] ?? null;
}

/** Back to the plan's version of a meal (portions recomputed for the day). */
export const resetMeal = (meal) => (day) => {
  const m = day.meals[meal];
  return setMeal(meal, { recipeId: m.recipeId, items: [], totals: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 } })(day);
};

export const dismissSuggestion = (key) => (day) => ({ ...day, dismissed: { ...(day.dismissed ?? {}), [key]: true } });

export const setDone = (meal, done) => (day) => setMeal(meal, { ...day.meals[meal], done })(day);

/** Replace a planned meal with a meal eaten out; the planned one is kept to undo. */
export const eatOut = (meal, preset) => (day) => setMeal(meal, { external: preset, replaced: day.meals[meal], totals: presetTotals(preset), done: true })(day);
export const undoEatOut = (meal) => (day) => setMeal(meal, day.meals[meal].replaced)(day);

export const addExtra = (preset) => (day) => ({ ...day, extras: [...(day.extras ?? []), { ...preset, uid: Math.random().toString(36).slice(2, 8) }] });
export const removeExtra = (uid) => (day) => ({ ...day, extras: (day.extras ?? []).filter((e) => e.uid !== uid) });

export function presetTotals(p) {
  return { kcal: p.kcal, protein: p.protein ?? 0, carbs: p.carbs ?? 0, fat: p.fat ?? 0, fiber: p.fiber ?? 0, salt: p.salt ?? 0 };
}

export function dayTotals(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 };
  for (const m of Object.values(day.meals)) if (m) for (const k in t) t[k] += m.totals[k] ?? 0;
  for (const e of day.extras ?? []) { const x = presetTotals(e); for (const k in t) t[k] += x[k]; }
  return t;
}

/**
 * Advice for one day, after the changes made to it (ingredients removed, meals swapped or eaten out).
 * Only gaps that matter: about 20 g of protein or 8 g of fibre.
 */
export function dayAdvice(totals, targets) {
  const advice = [];
  const proteinGap = targets.protein - totals.protein;
  if (proteinGap >= 20) {
    advice.push({
      title: 'Proteine di oggi',
      text: `Oggi arrivi a circa ${Math.round(totals.protein)} g di proteine su ${targets.protein} g. Se capita ogni tanto non è un problema. Se vuoi recuperare, la scelta più semplice è uno spuntino proteico della tua lista; in alternativa una dose di proteine del siero del latte (whey, circa 25 g di polvere = 20 g di proteine), che trovi al supermercato, in farmacia o nei negozi di sport.`,
    });
  }
  const fiberGap = targets.fiber - totals.fiber;
  if (fiberGap >= 8) {
    advice.push({
      title: 'Fibre di oggi',
      text: `Oggi le fibre sono circa ${Math.round(totals.fiber)} g su ${targets.fiber} g: puoi aggiungere più finocchio o insalata, oppure 5 g di psillio sciolti in un bicchiere grande d'acqua.`,
    });
  }
  return advice;
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
