// How a product is measured in the kitchen. step = smallest sensible increment in grams.
// unit: a natural portion shown next to the grams (e.g. "2 uova").
// fine: smaller step used when adjusting a dish by hand (e.g. part of a pouch, weighed).
export const UNITS = {
  uova: { step: 50, unit: ['uovo', 'uova', 50] },
  banana: { step: 60, unit: ['banana', 'banane', 120] },
  mela_golden: { step: 75, unit: ['mela', 'mele', 150] },
  limone: { step: 10 },
  pan_di_stelle: { step: 12.5, unit: ['biscotto', 'biscotti', 12.5] },
  misura_avena: { step: 10, unit: ['biscotto', 'biscotti', 10] },
  dolciando_cacao_nocciole: { step: 10, unit: ['frollino', 'frollini', 10] },
  zeropiu_balocco: { step: 35, unit: ['bustina', 'bustine', 35] },
  cracker_integrali: { step: 25, unit: ['pacchetto', 'pacchetti', 25] },
  piadelle_integrali: { step: 75, unit: ['piadella', 'piadelle', 75] },
  granpiada: { step: 55, unit: ['mezza piadina', 'mezze piadine', 55] },
  pane_integrale: { step: 30, unit: ['fetta', 'fette', 30] },
  grissini_sesamo: { step: 5, unit: ['grissino', 'grissini', 5] },
  dessert_proteico_lidl: { step: 200, unit: ['vasetto', 'vasetti', 200] },
  pro_high_cacao: { step: 200, unit: ['vasetto', 'vasetti', 200] },
  tonno_rio_mare: { step: 80, unit: ['scatoletta', 'scatolette', 80] },
  wurstel_tobias: { step: 50, unit: ['würstel', 'würstel', 50] },
  pizza_buitoni_creazione: { step: 100, fine: 25 },
  riso_nero_pronto: { step: 125, fine: 25, unit: ['mezza busta', 'mezze buste', 125] },
  olio_evo: { step: 5, spoon: true },
  burro_conad: { step: 5 },
  sale: { step: 1 },
  zucchero: { step: 5 },
  mandorle: { step: 5, unit: ['mandorla', 'mandorle', 1.2] },
  nutella: { step: 5, spoon: true },
  pesto_senza_aglio: { step: 10 },
  fresca_mayo: { step: 5 },
  parmigiano_grattugiato: { step: 5 },
  risette: { step: 10 },
  latte_ps: { step: 50, ml: true },
};

const DEFAULT = { step: 10 };

// A sensible amount to start from when adding a product to a meal by hand.
const ADD_DEFAULT = { parmigiano_grattugiato: 10, olio_evo: 5, burro_conad: 5, sale: 1, pepe_nero: 1, paprika: 1, prezzemolo: 3, basilico: 3, aglio: 3, limone: 10, fresca_mayo: 15, pesto_senza_aglio: 20, mutti_datterini: 100, insalata: 100, finocchio: 150, cipolla: 50, soffritto: 40, zucchero: 5, nutella: 15 };
export function addDefault(id) {
  if (ADD_DEFAULT[id]) return ADD_DEFAULT[id];
  const u = unitsFor(id);
  if (!u.unit) return 50;
  // Tiny pieces (an almond weighs about a gram): start from a handful of about 15 g, not from one.
  return u.unit[2] < 10 ? Math.round(15 / u.unit[2]) * u.unit[2] : u.unit[2];
}
export const unitsFor = (id) => UNITS[id] ?? DEFAULT;

/** "2 uova (100 g)", "1 cucchiaio (10 g)", "250 ml". */
export function formatQty(id, grams) {
  const u = unitsFor(id);
  const g = Math.round(grams * 10) / 10;
  if (u.ml) return `${Math.round(g)} ml`;
  if (u.spoon) {
    if (g >= 10 && g % 10 === 0) return `${g / 10} cucchiai${g === 10 ? 'o' : ''} (${g} g)`;
    if (g <= 5) return `1 cucchiaino (${g} g)`;
  }
  if (u.unit) {
    const [one, many, w] = u.unit;
    const n = Math.round((g / w) * 2) / 2;
    if (w >= 5 && n > 0) return `${n === 0.5 ? '½' : String(n).replace('.', ',')} ${n <= 1 ? one : many} (${Math.round(g)} g)`;
  }
  return `${Math.round(g)} g`;
}

/**
 * Countable products (würstel, eggs, slices, biscuits, pots…) are adjusted by pieces, not grams.
 * Returns { one, many, w } or null when the product is weighed (pasta, rice, oil…).
 */
export function pieceUnit(id) {
  const u = unitsFor(id);
  if (!u.unit || u.fine || u.ml || u.unit[2] < 5) return null;
  const [one, many, w] = u.unit;
  return { one, many, w };
}
