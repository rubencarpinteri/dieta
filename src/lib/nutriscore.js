// Nutri-Score 2023 (solid foods). Used only when Open Food Facts has no score,
// so results are flagged as "stimato".
// Nutrient inputs are per 100 g: energyKcal, sugars, satFat, fat, salt, fiber, protein, fvl (% fruit/veg/legumes).

const steps = (value, thresholds) => thresholds.filter((t) => value > t).length;

const ENERGY_KJ = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];
const SAT_FAT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SALT = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8, 4];
const PROTEIN = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];
const FIBER = [3.0, 4.1, 5.2, 6.3, 7.4];
// Fats, oils, nuts and seeds category
const ENERGY_FROM_SAT_KJ = [120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200];
const SAT_RATIO = [10, 16, 22, 28, 34, 40, 46, 52, 58, 64];

const fvlPoints = (fvl) => (fvl > 80 ? 5 : fvl > 60 ? 2 : fvl > 40 ? 1 : 0);

/** @param {{energyKcal:number,sugars:number,satFat:number,fat:number,salt:number,fiber:number,protein:number,fvl?:number}} n
 *  @param {'general'|'cheese'|'fats'|'redMeat'} kind */
export function nutriScore(n, kind = 'general') {
  const fvl = fvlPoints(n.fvl ?? 0);
  const fiber = steps(n.fiber ?? 0, FIBER);
  let protein = steps(n.protein ?? 0, PROTEIN);
  if (kind === 'redMeat') protein = Math.min(protein, 2);

  let negative;
  if (kind === 'fats') {
    const satKj = (n.satFat ?? 0) * 37;
    const ratio = n.fat > 0 ? (100 * (n.satFat ?? 0)) / n.fat : 0;
    negative = steps(satKj, ENERGY_FROM_SAT_KJ) + steps(n.sugars ?? 0, SUGARS) + steps(ratio, SAT_RATIO) + steps(n.salt ?? 0, SALT);
  } else {
    negative = steps((n.energyKcal ?? 0) * 4.184, ENERGY_KJ) + steps(n.sugars ?? 0, SUGARS) + steps(n.satFat ?? 0, SAT_FAT) + steps(n.salt ?? 0, SALT);
  }

  const countProtein = kind === 'cheese' || negative < (kind === 'fats' ? 7 : 11) || fvl === 5;
  const points = negative - fiber - fvl - (countProtein ? protein : 0);
  const cuts = kind === 'fats' ? [-6, 2, 10, 18] : [0, 2, 10, 18];
  const grade = 'abcde'[cuts.filter((c) => points > c).length];
  return { points, grade };
}
