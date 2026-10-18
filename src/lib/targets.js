// Daily energy and macro targets for weight loss.
// BMR: Mifflin-St Jeor. Protein is set on a reference weight so it stays sensible at high BMI.

export const ACTIVITY = {
  sedentario: { factor: 1.2, label: 'Sedentario', hint: 'Riposo, poco movimento' },
  leggero: { factor: 1.375, label: 'Leggero', hint: 'In piedi molte ore (es. turni di volo), niente sport' },
  moderato: { factor: 1.55, label: 'Moderato', hint: 'Turni in piedi + sport 2-3 volte a settimana' },
  intenso: { factor: 1.725, label: 'Intenso', hint: 'Sport quasi tutti i giorni' },
};

export const PACE = {
  0.25: 'Graduale (−0,25 kg/settimana)',
  0.5: 'Standard (−0,5 kg/settimana)',
  0.75: 'Deciso (−0,75 kg/settimana)',
};

const KCAL_PER_KG_FAT = 7700;
const MIN_KCAL = { M: 1500, F: 1200 };

export function bmr({ sex, age, heightCm, weightKg }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'M' ? 5 : -161);
}

/** Returns targets plus warnings in Italian. */
export function dailyTargets(profile) {
  const warnings = [];
  const base = bmr(profile);
  const tdee = base * ACTIVITY[profile.activity].factor;
  const bmi = profile.weightKg / (profile.heightCm / 100) ** 2;

  let deficit = (Number(profile.pace) * KCAL_PER_KG_FAT) / 7;
  if (profile.pregnant) {
    deficit = 0;
    warnings.push('In gravidanza o allattamento non si imposta un deficit calorico: il piano è di mantenimento. Segui le indicazioni del tuo medico.');
  }
  if (bmi < 18.5) {
    deficit = 0;
    warnings.push('Il tuo indice di massa corporea è sotto il normale: non ti propongo un deficit. Parlane con un medico.');
  }

  // Only the absolute safety minimum is enforced. Eating below BMR is allowed: the body still burns
  // its total daily expenditure, so weight loss continues; protein stays high to protect muscle.
  const floor = MIN_KCAL[profile.sex];
  let kcal = Math.round(tdee - deficit);
  if (kcal < floor) {
    kcal = floor;
    warnings.push(`Ho alzato le calorie a ${floor} kcal, la soglia minima di sicurezza: sotto questo valore è difficile coprire vitamine e minerali senza un medico. Il calo sarà un po' più lento.`);
  }

  // Reference weight: current weight, or weight at BMI 25 when overweight.
  const refWeight = bmi > 25 ? 25 * (profile.heightCm / 100) ** 2 : profile.weightKg;
  const protein = Math.round(1.6 * refWeight);
  const fat = Math.round(Math.max(0.8 * refWeight, (0.3 * kcal) / 9));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const fiber = Math.max(25, Math.round((14 * kcal) / 1000));

  const weeklyLoss = ((tdee - kcal) * 7) / KCAL_PER_KG_FAT;
  return { bmr: Math.round(base), tdee: Math.round(tdee), kcal, protein, fat, carbs, fiber, bmi: Math.round(bmi * 10) / 10, weeklyLoss, warnings };
}

export function ageFrom(birthYear) {
  return new Date().getFullYear() - birthYear;
}
