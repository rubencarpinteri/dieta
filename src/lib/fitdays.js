// Reads the values of a Fitdays report from OCR text (first page, the one with the table).
// Every value is validated against a plausible range; the user always checks them before saving.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const n = (s) => Number(String(s).replace(',', '.'));
const inRange = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function parseFitdays(text) {
  const t = text.replace(/\s+/g, ' ');
  const grab = (re) => re.exec(t)?.[1];
  const out = {};

  const d = /Testing time:?\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})/.exec(t);
  if (d && MONTHS[d[1].toLowerCase()]) out.date = `${d[3]}-${String(MONTHS[d[1].toLowerCase()]).padStart(2, '0')}-${d[2].padStart(2, '0')}`;

  const kg = inRange(n(grab(/Weight\s+(\d{2,3}[.,]\d)\s*\(/)), 30, 300);
  if (kg) out.kg = kg;
  const muscle = inRange(n(grab(/Muscle Mass\s+(\d{2,3}[.,]\d)\s*\(/)), 15, 120);
  if (muscle) out.muscleKg = muscle;
  const water = inRange(n(grab(/Water Weight\s+\d{2,3}[.,]\d\s*\([^)]*\)\s*(\d{2}[.,]\d)/)), 30, 80);
  if (water) out.waterPct = water;
  const visceral = inRange(n(grab(/Visceral fat grade\s+(\d{1,2})\b/)), 1, 59);
  if (visceral) out.visceral = visceral;

  // Body fat %: from the table if readable, otherwise from fat-free mass (more reliable for OCR).
  let fat = inRange(n(grab(/Fat Mass\s+\d{1,3}[.,]\d\s*\([^)]*\)\s*(\d{1,2}[.,]\d)\s/)), 3, 70);
  const ffm = inRange(n(grab(/Fat-free body weight\s+(\d{2,3}[.,]\d)/)), 20, 200);
  if (out.kg && ffm && ffm < out.kg) {
    const fromFfm = Math.round(((out.kg - ffm) / out.kg) * 1000) / 10;
    if (!fat || Math.abs(fat - fromFfm) > 1) fat = fromFfm;
  }
  if (fat) out.fatPct = fat;
  return out;
}
