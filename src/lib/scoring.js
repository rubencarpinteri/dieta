// Yuka-style score 0-100: nutritional quality 60, additives 30, organic 10.
// A high-risk additive caps the total at 49 (same rule Yuka publishes).
import { ADDITIVES } from './additives.js';

const PENALTY = { none: 0, limited: 3, moderate: 10, high: 30 };

export function qualityScore(product) {
  // Herbs, spices, salt and sugar are used in grams: a per-100 g score would be meaningless.
  if (product.category === 'aromi' || product.unrated) return { score: null, label: 'Non valutato' };
  const p = product.nutriscore?.points;
  const nutrition = p == null ? null : Math.max(0, Math.min(60, (60 * (25 - p)) / 35));

  const additives = product.additives ?? [];
  const risks = additives.map((code) => ADDITIVES[code]?.risk ?? 'none');
  const additiveScore = Math.max(0, 30 - risks.reduce((sum, r) => sum + PENALTY[r], 0));
  const organic = product.organic ? 10 : 0;

  if (nutrition == null) return { score: null, label: 'Dati insufficienti' };
  let score = Math.round(nutrition + additiveScore + organic);
  if (risks.includes('high')) score = Math.min(score, 49);
  return { score, label: labelFor(score), parts: { nutrition: Math.round(nutrition), additives: additiveScore, organic } };
}

export function labelFor(score) {
  if (score >= 75) return 'Eccellente';
  if (score >= 50) return 'Buono';
  if (score >= 25) return 'Mediocre';
  return 'Scarso';
}
