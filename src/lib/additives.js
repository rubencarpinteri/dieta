// Risk level of additives, Yuka-style: 'none' | 'limited' | 'moderate' | 'high'.
// Based on EFSA re-evaluations and the main independent studies; notes are shown to the user.
export const ADDITIVES = {
  e14xx: { name: 'Amidi modificati', risk: 'none' },
  e250: { name: 'Nitrito di sodio', risk: 'high', note: 'Forma nitrosammine; IARC associa le carni trasformate al cancro colorettale.' },
  e251: { name: 'Nitrato di sodio', risk: 'high', note: 'Si trasforma in nitrito; stesse criticità di E250.' },
  e252: { name: 'Nitrato di potassio', risk: 'high', note: 'Si trasforma in nitrito; stesse criticità di E250.' },
  e270: { name: 'Acido lattico', risk: 'none' },
  e301: { name: 'Ascorbato di sodio', risk: 'none' },
  e322: { name: 'Lecitine', risk: 'none' },
  e330: { name: 'Acido citrico', risk: 'none' },
  e331: { name: 'Citrati di sodio', risk: 'none' },
  e392: { name: 'Estratto di rosmarino', risk: 'none' },
  e407: { name: 'Carragenina', risk: 'moderate', note: 'Studi su possibile infiammazione intestinale; EFSA ne ha chiesto nuovi dati.' },
  e412: { name: 'Gomma di guar', risk: 'none' },
  e422: { name: 'Glicerolo', risk: 'none' },
  e450: { name: 'Difosfati', risk: 'moderate', note: 'Fosfati aggiunti: un eccesso è associato a rischio cardiovascolare e renale.' },
  e451: { name: 'Trifosfati', risk: 'moderate', note: 'Fosfati aggiunti: un eccesso è associato a rischio cardiovascolare e renale.' },
  e466: { name: 'Carbossimetilcellulosa', risk: 'moderate', note: 'Studi indicano effetti negativi sul microbiota intestinale.' },
  e471: { name: 'Mono- e digliceridi degli acidi grassi', risk: 'limited', note: 'Emulsionante; studi osservazionali ne indagano effetti cardiovascolari.' },
  e500: { name: 'Carbonati di sodio', risk: 'none' },
  e503: { name: 'Carbonati di ammonio', risk: 'none' },
  e621: { name: 'Glutammato monosodico', risk: 'limited' },
  e950: { name: 'Acesulfame K', risk: 'moderate', note: 'Edulcorante; studi osservazionali (NutriNet-Santé) lo associano a rischio cardiovascolare.' },
  e955: { name: 'Sucralosio', risk: 'moderate', note: 'Edulcorante; studi recenti su effetti sul microbiota e su un metabolita genotossico.' },
  e965: { name: 'Maltitolo', risk: 'limited', note: 'Polialcol: in quantità elevate ha effetto lassativo.' },
};

/** Normalize OFF tags like 'en:e500ii' to the base code 'e500'. Unknown codes are ignored. */
export function normalizeAdditives(tags = []) {
  const codes = new Set();
  for (const tag of tags) {
    const m = /e(\d{3,4}|14xx)/.exec(tag);
    if (m && ADDITIVES['e' + m[1]]) codes.add('e' + m[1]);
  }
  return [...codes];
}
