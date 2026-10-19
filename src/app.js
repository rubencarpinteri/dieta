import { html, render, useState, useEffect, useMemo } from '../vendor/preact-htm.js';
import { load, save, exportJson, uid, today, emptyState } from './store.js';
import { qualityScore } from './lib/scoring.js';
import { ADDITIVES } from './lib/additives.js';
import { dailyTargets, ageFrom, ACTIVITY, PACE } from './lib/targets.js';
import { generateWeek, swapMeal, dayTotals, supplementAdvice, eligibleRecipes, MEAL_ORDER, MEAL_LABEL, FASTING, DAY_TYPES, DEFAULT_ONBOARD } from './lib/planner.js';
import { RECIPES } from './lib/recipes.js';
import { formatQty } from './lib/units.js';
import { shoppingList } from './lib/shopping.js';
import { searchProducts, productByBarcode, fromOff, manualProduct } from './lib/off.js';
import { parseFitdays } from './lib/fitdays.js';

const CATEGORIES = {
  proteine: 'Carne, pesce, uova e salumi', cereali: 'Pasta, riso, pane e cracker', latticini: 'Latte, formaggi e dessert proteici',
  verdure: 'Verdure', frutta: 'Frutta', frutta_secca: 'Frutta secca', condimenti: 'Condimenti e salse',
  aromi: 'Spezie e aromi', dolci: 'Dolci e biscotti', pronti: 'Piatti pronti',
};
const METHOD = { microonde: '⚡ Microonde', friggitrice: '💨 Friggitrice ad aria', padella: '🍳 Padella', pentola: '🍝 Pentola', nessuna: '🥪 Senza cottura' };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const recipeById = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const r0 = (n) => Math.round(n);
const dec = (n) => (Math.round(n * 10) / 10).toLocaleString('it-IT');

// ───────────────────────── App shell ─────────────────────────
function App() {
  const [state, setState] = useState(load);
  const [base, setBase] = useState(null);
  const [tab, setTab] = useState('piano');
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('data/products.json').then((r) => r.json()).then(setBase).catch(() => setError('Impossibile caricare i prodotti.'));
  }, []);
  useEffect(() => save(state), [state]);

  const products = useMemo(() => (base ? [...base, ...state.customProducts] : []), [base, state.customProducts]);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const profile = state.profiles.find((p) => p.id === state.activeId);
  const update = (fn) => setState((s) => { const copy = structuredClone(s); return fn(copy) ?? copy; });
  const updateProfile = (fn) => update((s) => { fn(s.profiles.find((p) => p.id === s.activeId), s); });

  if (error) return html`<main class="center"><p>${error}</p></main>`;
  if (!base) return html`<main class="center"><p class="muted">Caricamento…</p></main>`;
  if (!profile) return html`<${Onboarding} state=${state} base=${base} onDone=${(p, mode) => update((s) => {
    if (mode) s.household.mode = mode;
    s.profiles.push(p); s.activeId = p.id;
  })} onCancel=${state.profiles.length ? () => update((s) => { s.activeId = s.profiles[0].id; }) : null} />`;

  const targets = dailyTargets({ ...profile, age: ageFrom(profile.birthYear) });
  const ctx = { state, profile, products, byId, targets, update, updateProfile };
  const TABS = [['piano', '🗓️', 'Piano'], ['prodotti', '🛒', 'Prodotti'], ['spesa', '📝', 'Spesa'], ['peso', '⚖️', 'Peso'], ['profilo', '👤', 'Profilo']];

  return html`
    <header class="top">
      <h1>${TABS.find((t) => t[0] === tab)[2]}</h1>
      ${state.profiles.length > 1 && html`<select class="who" value=${state.activeId} onChange=${(e) => update((s) => { s.activeId = e.target.value; })}>
        ${state.profiles.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>`}
    </header>
    <main>
      ${tab === 'piano' && html`<${PlanTab} ...${ctx} />`}
      ${tab === 'prodotti' && html`<${ProductsTab} ...${ctx} />`}
      ${tab === 'spesa' && html`<${ShoppingTab} ...${ctx} />`}
      ${tab === 'peso' && html`<${WeightTab} ...${ctx} />`}
      ${tab === 'profilo' && html`<${ProfileTab} ...${ctx} />`}
    </main>
    <nav class="tabs">
      ${TABS.map(([id, icon, label]) => html`<button class=${tab === id ? 'on' : ''} onClick=${() => { setTab(id); scrollTo(0, 0); }}>
        <span aria-hidden="true">${icon}</span>${label}</button>`)}
    </nav>`;
}

// ───────────────────────── Onboarding / profile form ─────────────────────────
const blankProfile = () => ({
  id: uid(), name: '', sex: 'M', birthYear: 1990, heightCm: 175, weightKg: 80, goalKg: 72, activity: 'leggero', pace: 0.5,
  pregnant: false, medical: false, medicalNote: '', fasting: 'nessuno', cooking: 'momento', microwaveW: 800,
  overnight: false, onboard: DEFAULT_ONBOARD,
  approved: [], dayTypes: Array(7).fill('casa'), plan: null, weights: [], shoppingChecked: {},
});

function Onboarding({ state, base, onDone, onCancel }) {
  const first = state.profiles.length === 0;
  const [step, setStep] = useState(first ? 0 : 1);
  const [mode, setMode] = useState(state.household.mode);
  const [p, setP] = useState(blankProfile);
  const finish = () => {
    const profile = { ...p, approved: first ? base.map((x) => x.id) : [], weights: [{ date: today(), kg: Number(p.weightKg) }] };
    onDone(profile, first ? mode : null);
  };
  return html`<main class="onboarding">
    ${step === 0 && html`<section class="card">
      <h1>Benvenuto 👋</h1>
      <p>Questa app crea un piano alimentare per dimagrire usando <b>solo i prodotti che compri tu</b>.</p>
      <p>Chi la userà?</p>
      <label class="choice"><input type="radio" checked=${mode === 'singolo'} onChange=${() => setMode('singolo')} /> <span><b>Solo io</b></span></label>
      <label class="choice"><input type="radio" checked=${mode === 'coppia'} onChange=${() => setMode('coppia')} /> <span><b>Due persone</b> (coppia o coinquilini): dispensa in comune, piani personali</span></label>
      <button class="primary" onClick=${() => setStep(1)}>Continua</button>
    </section>`}
    ${step === 1 && html`<section class="card">
      <h1>${first ? 'Il tuo profilo' : 'Nuova persona'}</h1>
      <${ProfileFields} p=${p} set=${setP} />
      <button class="primary" disabled=${!p.name.trim()} onClick=${() => setStep(2)}>Continua</button>
      ${onCancel && html`<button class="ghost" onClick=${onCancel}>Annulla</button>`}
    </section>`}
    ${step === 2 && html`<section class="card">
      <h1>Abitudini</h1>
      <${HabitFields} p=${first ? { ...p, approved: base.map((x) => x.id) } : p} set=${(v) => setP({ ...v, approved: p.approved })} />
      <p class="muted small">${first
        ? `La tua lista contiene già ${base.length} prodotti approvati: potrai modificarla in "Prodotti".`
        : 'Dopo, in "Prodotti", spunta gli alimenti che vuoi nel tuo piano: partirai da una lista vuota.'}</p>
      <button class="primary" onClick=${finish}>Crea il profilo</button>
      <button class="ghost" onClick=${() => setStep(1)}>Indietro</button>
    </section>`}
  </main>`;
}

const field = (p, set, key, parse = (v) => v) => ({ value: p[key], onInput: (e) => set({ ...p, [key]: parse(e.target.value) }) });
const num = (v) => (v === '' ? '' : Number(String(v).replace(',', '.')));

function ProfileFields({ p, set, editWeight = true }) {
  return html`
    <label>Nome<input ...${field(p, set, 'name')} placeholder="Es. Ruben" /></label>
    <div class="row">
      <label>Sesso<select ...${field(p, set, 'sex')}><option value="M">Uomo</option><option value="F">Donna</option></select></label>
      <label>Anno di nascita<input type="number" inputmode="numeric" ...${field(p, set, 'birthYear', num)} /></label>
    </div>
    <div class="row">
      <label>Altezza (cm)<input type="number" inputmode="numeric" ...${field(p, set, 'heightCm', num)} /></label>
      ${editWeight && html`<label>Peso di partenza (kg)<input type="number" inputmode="decimal" step="0.1" ...${field(p, set, 'weightKg', num)} /></label>`}
      <label>Obiettivo (kg)<input type="number" inputmode="decimal" step="0.1" ...${field(p, set, 'goalKg', num)} /></label>
    </div>
    <label>Attività fisica<select ...${field(p, set, 'activity')}>
      ${Object.entries(ACTIVITY).map(([k, a]) => html`<option value=${k}>${a.label} — ${a.hint}</option>`)}</select></label>
    <label>Ritmo di dimagrimento<select ...${field(p, set, 'pace', Number)}>
      ${Object.entries(PACE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
    ${p.sex === 'F' && html`<label class="check"><input type="checkbox" checked=${p.pregnant} onChange=${(e) => set({ ...p, pregnant: e.target.checked })} /> Sono in gravidanza o allatto</label>`}
    <label class="check"><input type="checkbox" checked=${p.medical} onChange=${(e) => set({ ...p, medical: e.target.checked })} /> Ho condizioni mediche o prendo farmaci (diabete, tiroide, pressione…)</label>
    ${p.medical && html`<label>Note (restano solo su questo telefono)<input ...${field(p, set, 'medicalNote')} /></label>`}`;
}

function HabitFields({ p, set }) {
  return html`
    <label>Digiuno intermittente<select ...${field(p, set, 'fasting')}>
      ${Object.entries(FASTING).map(([k, f]) => html`<option value=${k}>${f.label}</option>`)}</select></label>
    <p class="muted small">A parità di calorie il digiuno intermittente non fa dimagrire di più. Visto che sei già abituato al deficit, attivalo solo se ti viene naturale saltare la colazione o se ti semplifica i turni.</p>
    <label>Come preferisci cucinare?<select ...${field(p, set, 'cooking')}>
      <option value="momento">Al momento, ogni giorno</option>
      <option value="prep">Meal prep: cucino una volta per 2 giorni</option></select></label>
    <label>Potenza del microonde (watt)<input type="number" inputmode="numeric" ...${field(p, set, 'microwaveW', num)} /></label>
    <${OnboardFields} p=${p} set=${set} />`;
}

function OnboardFields({ p, set }) {
  const onboard = p.onboard ?? DEFAULT_ONBOARD;
  const options = eligibleRecipes(new Set(p.approved ?? [])).filter((r) => r.portable && r.meals.includes('pranzo'));
  const toggle = (id) => set({ ...p, onboard: onboard.includes(id) ? onboard.filter((x) => x !== id) : [...onboard, id] });
  return html`
    <label class="check"><input type="checkbox" checked=${!!p.overnight} onChange=${(e) => set({ ...p, overnight: e.target.checked })} /> Faccio anche voli con pernotto</label>
    <p class="label-like">Cosa mangi a bordo nei giorni di volo</p>
    ${options.length === 0 ? html`<p class="muted small">Nessun pasto da portare possibile con i prodotti della tua lista.</p>`
      : options.map((r) => html`<label class="check"><input type="checkbox" checked=${onboard.includes(r.id)} onChange=${() => toggle(r.id)} /> ${r.name}</label>`)}
    <p class="muted small">Nei giorni di volo il pranzo sarà scelto solo tra questi. Se non ne spunti nessuno, userò qualsiasi pasto da portare.</p>`;
}

// ───────────────────────── Plan ─────────────────────────
function startDate(plan) { return new Date(plan.startDate + 'T12:00:00'); }
function dayLabel(plan, i) {
  const d = startDate(plan); d.setDate(d.getDate() + i);
  return { short: WEEKDAYS[d.getDay()], date: d.getDate() };
}

function PlanTab({ profile, byId, targets, updateProfile }) {
  const plan = profile.plan;
  const approved = useMemo(() => new Set(profile.approved), [profile.approved]);
  const [day, setDay] = useState(() => {
    if (!plan) return 0;
    const diff = Math.floor((new Date(today()) - new Date(plan.startDate)) / 864e5);
    return diff >= 0 && diff < 7 ? diff : 0;
  });
  const [open, setOpen] = useState(null);
  const opts = { approved, targets, fasting: profile.fasting, cooking: profile.cooking, dayTypes: profile.dayTypes, onboard: profile.onboard ?? DEFAULT_ONBOARD };

  const newPlan = () => updateProfile((p) => {
    p.plan = { ...generateWeek({ ...opts, seed: Date.now() }, byId), startDate: today() };
    p.shoppingChecked = {};
  });

  if (approved.size < 8) return html`<section class="card"><h2>Prima scegli i tuoi prodotti</h2>
    <p>Vai su <b>Prodotti</b> e spunta gli alimenti che mangi. Il piano userà solo quelli.</p></section>`;
  if (!plan) return html`<section class="card">
      <h2>Nessun piano ancora</h2>
      <p>Obiettivo giornaliero: <b>${targets.kcal} kcal</b>, ${targets.protein} g di proteine.</p>
      <p class="muted small">Prima di generarlo puoi indicare i giorni di volo: lo farai anche dopo, giorno per giorno.</p>
      <button class="primary" onClick=${newPlan}>Genera il piano della settimana</button>
    </section>`;

  const current = plan.days[day];
  const totals = dayTotals(current);
  const avg = plan.days.map(dayTotals).reduce((a, t) => { for (const k in t) a[k] = (a[k] ?? 0) + t[k] / 7; return a; }, {});
  const advice = supplementAdvice(avg, targets);

  const setDayType = (type) => updateProfile((p) => {
    p.dayTypes[day] = type;
    const one = generateWeek({ ...opts, dayTypes: [type], seed: Date.now() }, byId).days[0];
    p.plan.days[day] = one;
  });

  return html`
    ${targets.warnings.map((w) => html`<p class="warn">${w}</p>`)}
    ${plan.targetKcal && Math.abs(plan.targetKcal - targets.kcal) > 50 && html`<p class="warn">Questo piano è stato creato per ${plan.targetKcal} kcal al giorno, ma ora il tuo obiettivo è ${targets.kcal} kcal. Genera un nuovo piano (in fondo alla pagina) per aggiornare le porzioni.</p>`}
    ${!plan.targetKcal && html`<p class="warn">Questo piano è stato creato con una versione precedente dell'app. Genera un nuovo piano (in fondo alla pagina) per avere le porzioni giuste per il tuo obiettivo.</p>`}
    <div class="days">${plan.days.map((_, i) => { const l = dayLabel(plan, i); return html`
      <button class=${i === day ? 'on' : ''} onClick=${() => { setDay(i); setOpen(null); }}>
        <small>${l.short}</small><b>${l.date}</b>${plan.days[i].type !== 'casa' && html`<span class="dot">✈️</span>`}</button>`; })}</div>

    <section class="card tight">
      <div class="segmented">${Object.entries(DAY_TYPES).filter(([k]) => k !== 'pernotto' || profile.overnight || current.type === k).map(([k, t]) => html`
        <button class=${current.type === k ? 'on' : ''} onClick=${() => current.type !== k && setDayType(k)}>${t.label}</button>`)}</div>
      <${Totals} totals=${totals} targets=${targets} />
    </section>

    ${MEAL_ORDER.filter((m) => m in current.meals).map((meal) => {
      const m = current.meals[meal];
      if (!m) return html`<section class="card"><h3>${MEAL_LABEL[meal]}</h3><p class="muted">Nessuna ricetta possibile con i tuoi prodotti per questo pasto.</p></section>`;
      const r = recipeById[m.recipeId];
      const isOpen = open === meal;
      return html`<section class="card meal">
        <div class="meal-head" onClick=${() => setOpen(isOpen ? null : meal)}>
          <div><small class="muted">${MEAL_LABEL[meal]} · ${r0(m.totals.kcal)} kcal · ${r0(m.totals.protein)} g prot.</small>
            <h3>${r.name}${m.leftover ? html` <span class="tag">avanzo di ieri</span>` : ''}</h3>
            <small class="muted">${METHOD[r.method]}${r.minutes ? ` · ${r.minutes} min` : ''}${r.portable ? ' · da portare' : ''}</small></div>
          <span class="chev">${isOpen ? '▴' : '▾'}</span>
        </div>
        <ul class="items">${m.items.map((it) => html`<li><span>${byId[it.p].name}</span><b>${formatQty(it.p, it.g)}</b></li>`)}</ul>
        ${isOpen && html`<ol class="steps">${r.steps.map((s) => html`<li>${stepText(s, m.items, profile.microwaveW)}</li>`)}</ol>`}
        <div class="actions">
          <button class="ghost small" onClick=${() => setOpen(isOpen ? null : meal)}>${isOpen ? 'Nascondi' : 'Come si prepara'}</button>
          <button class="ghost small" onClick=${() => updateProfile((p) => { p.plan = swapMeal(p.plan, day, meal, opts, byId); })}>🔄 Cambia</button>
        </div>
      </section>`;
    })}

    ${advice.length > 0 && html`<section class="card note"><h3>💊 Integratori consigliati</h3>
      ${advice.map((a) => html`<p><b>${a.title}.</b> ${a.text}</p>`)}
      <p class="muted small">Sono suggerimenti generali: se hai condizioni mediche, chiedi prima al medico o al farmacista.</p></section>`}

    <section class="card">
      <p class="small muted">Media settimanale: ${r0(avg.kcal)} kcal · P ${r0(avg.protein)} g · C ${r0(avg.carbs)} g · G ${r0(avg.fat)} g · fibre ${r0(avg.fiber)} g</p>
      <button class="ghost" onClick=${() => confirm('Generare un nuovo piano per i prossimi 7 giorni?') && newPlan()}>Genera un nuovo piano</button>
    </section>`;
}

/** Fill {productId} placeholders and convert microwave times when the oven is not 800 W. */
function stepText(step, items, watt = 800) {
  let s = step.replace(/\{(\w+)\}/g, (_, id) => { const it = items.find((i) => i.p === id); return it ? formatQty(id, it.g) : ''; });
  if (watt && watt !== 800 && /[Mm]icroonde/.test(s)) s += ` (con il tuo microonde da ${watt} W: circa ${Math.round((800 / watt) * 100)}% del tempo)`;
  return s;
}

function Totals({ totals, targets }) {
  const bars = [['Calorie', totals.kcal, targets.kcal, 'kcal'], ['Proteine', totals.protein, targets.protein, 'g'], ['Carboidrati', totals.carbs, targets.carbs, 'g'], ['Grassi', totals.fat, targets.fat, 'g'], ['Fibre', totals.fiber, targets.fiber, 'g']];
  return html`<div class="totals">${bars.map(([l, v, t, u]) => html`
    <div class="bar"><div class="bar-label"><span>${l}</span><span>${r0(v)} / ${t} ${u}</span></div>
      <div class="track"><div class=${'fill' + (v > t * (l === 'Calorie' ? 1.05 : 1.15) ? ' over' : '')} style=${`width:${Math.min(100, (v / t) * 100)}%`}></div></div></div>`)}
    ${totals.salt > 6 && html`<p class="small warn-text">Sale: ${dec(totals.salt)} g (consigliato massimo 5-6 g). Bevi acqua e non aggiungerne altro.</p>`}</div>`;
}

// ───────────────────────── Products ─────────────────────────
function ScoreBadge({ product }) {
  const q = qualityScore(product);
  const cls = q.score == null ? 'na' : q.score >= 75 ? 'exc' : q.score >= 50 ? 'good' : q.score >= 25 ? 'poor' : 'bad';
  return html`<span class=${'score ' + cls} title=${q.label}>${q.score ?? '–'}</span>`;
}

function ProductsTab({ profile, products, updateProfile, update }) {
  const [filter, setFilter] = useState('mine');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const approved = new Set(profile.approved);
  const toggle = (id) => updateProfile((p) => { p.approved = approved.has(id) ? p.approved.filter((x) => x !== id) : [...p.approved, id]; });
  const q = query.trim().toLowerCase();
  const visible = products.filter((p) => (filter === 'all' || approved.has(p.id)) && (!q || p.name.toLowerCase().includes(q)));

  return html`
    <div class="segmented"><button class=${filter === 'mine' ? 'on' : ''} onClick=${() => setFilter('mine')}>La mia lista (${approved.size})</button>
      <button class=${filter === 'all' ? 'on' : ''} onClick=${() => setFilter('all')}>Dispensa di casa (${products.length})</button></div>
    <input class="search" type="search" placeholder="Cerca un prodotto" value=${query} onInput=${(e) => setQuery(e.target.value)} />
    <button class="primary" onClick=${() => setAdding(true)}>＋ Aggiungi un prodotto</button>
    ${filter === 'all' && html`<p class="muted small">Spunta ✓ gli alimenti che vuoi nel tuo piano. Gli altri restano in dispensa per chi vive con te.</p>`}
    ${Object.entries(CATEGORIES).map(([cat, label]) => {
      const list = visible.filter((p) => p.category === cat).sort((a, b) => (qualityScore(b).score ?? -1) - (qualityScore(a).score ?? -1));
      return list.length > 0 && html`<section class="card tight"><h3>${label}</h3>
        <ul class="plist">${list.map((p) => html`<li>
          <button class="prow" onClick=${() => setDetail(p)}><${ScoreBadge} product=${p} />
            <span class="pname">${p.name}<small class="muted">${r0(p.nutrients.energyKcal)} kcal · ${dec(p.nutrients.protein)} g prot. /100 g${p.flags.length ? ' · ⚠️' : ''}</small></span></button>
          <button class=${'tick' + (approved.has(p.id) ? ' on' : '')} aria-label="Nella mia lista" onClick=${() => toggle(p.id)}>✓</button>
        </li>`)}</ul></section>`;
    })}
    ${detail && html`<${ProductDetail} product=${detail} onClose=${() => setDetail(null)} />`}
    ${adding && html`<${AddProduct} onClose=${() => setAdding(false)} existing=${products} onAdd=${(prod) => {
      update((s) => {
        if (!s.customProducts.some((x) => x.id === prod.id) && !products.some((x) => x.id === prod.id)) s.customProducts.push(prod);
        const p = s.profiles.find((x) => x.id === s.activeId);
        if (!p.approved.includes(prod.id)) p.approved.push(prod.id);
      });
      setAdding(false);
    }} />`}`;
}

function Sheet({ title, onClose, children }) {
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label=${title}>
      <div class="sheet-head"><h2>${title}</h2><button class="ghost small" onClick=${onClose}>Chiudi</button></div>
      ${children}</div></div>`;
}

function ProductDetail({ product: p, onClose }) {
  const q = qualityScore(p);
  const n = p.nutrients;
  const rows = [['Energia', `${r0(n.energyKcal)} kcal`], ['Proteine', n.protein], ['Carboidrati', n.carbs], ['di cui zuccheri', n.sugars], ['Grassi', n.fat], ['di cui saturi', n.satFat], ['Fibre', n.fiber], ['Sale', n.salt]];
  return html`<${Sheet} title=${p.name} onClose=${onClose}>
    <div class="score-big"><${ScoreBadge} product=${p} /><div><b>${q.label}</b>
      ${q.parts && html`<small class="muted">Nutrizione ${q.parts.nutrition}/60 · Additivi ${p.additivesKnown ? `${q.parts.additives}/30` : 'non verificati'} · Bio ${q.parts.organic}/10</small>`}
      ${q.parts && !p.additivesKnown && html`<small class="muted">Punteggio provvisorio: potrebbe scendere se l'etichetta contiene additivi a rischio.</small>`}</div></div>
    <p class="small">Nutri-Score <b>${p.nutriscore.grade.toUpperCase()}</b>${p.nutriscore.estimated ? ' (stimato)' : ''}${p.nova ? html` · NOVA <b>${p.nova}</b> ${p.nova === 4 ? '(ultra-trasformato)' : ''}` : ''}${p.organic ? ' · Biologico' : ''}</p>
    ${p.flags.map((f) => html`<p class="warn small">⚠️ ${f}</p>`)}
    <h3>Additivi</h3>
    ${!p.additivesKnown ? html`<p class="muted small">Non verificabili: ingredienti non disponibili.</p>`
      : p.additives.length === 0 ? html`<p class="small">Nessun additivo.</p>`
      : html`<ul class="additives">${p.additives.map((c) => { const a = ADDITIVES[c]; return html`<li><span class=${'risk ' + a.risk}></span>
          <div><b>${c.toUpperCase()} ${a.name}</b> <small class="muted">${{ none: 'nessun rischio', limited: 'rischio limitato', moderate: 'rischio moderato', high: 'rischio alto' }[a.risk]}</small>
          ${a.note && html`<br /><small>${a.note}</small>`}</div></li>`; })}</ul>`}
    <h3>Valori per 100 g</h3>
    <table class="nutr">${rows.map(([l, v]) => html`<tr><td>${l}</td><td>${typeof v === 'number' ? `${dec(v)} g` : v}</td></tr>`)}</table>
    <p class="muted small">Fonte: ${p.source === 'openfoodfacts' ? html`Open Food Facts${p.barcode ? ` (${p.barcode})` : ''}` : p.source === 'manuale' ? 'etichetta inserita a mano' : 'valori medi (tabelle CREA)'}${p.quantity ? ` · Confezione: ${p.quantity}` : ''}</p>
  <//>`;
}

function AddProduct({ onClose, onAdd, existing }) {
  const [mode, setMode] = useState('codice');
  const [text, setText] = useState('');
  const [brand, setBrand] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [manual, setManual] = useState({ name: '', category: 'pronti', quantity: '', energyKcal: '', protein: '', carbs: '', sugars: '', fat: '', satFat: '', fiber: '', salt: '' });

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message || 'Errore di rete.'); } setBusy(false); };
  const lookupBarcode = () => run(async () => setPicked(fromOff(await productByBarcode(text.trim()))));
  const search = () => run(async () => {
    const found = await searchProducts(brand, text);
    setResults(found);
    if (!found.length) setErr('Nessun prodotto trovato: prova a scrivere meno parole nel nome.');
  });

  return html`<${Sheet} title="Aggiungi un prodotto" onClose=${onClose}>
    <div class="segmented"><button class=${mode === 'codice' ? 'on' : ''} onClick=${() => { setMode('codice'); setErr(''); }}>Codice a barre</button>
      <button class=${mode === 'cerca' ? 'on' : ''} onClick=${() => { setMode('cerca'); setErr(''); }}>Cerca</button>
      <button class=${mode === 'manuale' ? 'on' : ''} onClick=${() => setMode('manuale')}>Dall'etichetta</button></div>
    ${picked ? html`
      <p><b>${picked.name}</b><br /><small class="muted">${picked.quantity ?? ''} · ${r0(picked.nutrients.energyKcal)} kcal/100 g</small></p>
      <label>Categoria<select value=${picked.category} onChange=${(e) => setPicked({ ...picked, category: e.target.value })}>
        ${Object.entries(CATEGORIES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      ${existing.some((x) => x.id === picked.id || (picked.barcode && x.barcode === picked.barcode)) && html`<p class="muted small">È già in dispensa: verrà aggiunto alla tua lista.</p>`}
      <button class="primary" onClick=${() => onAdd(existing.find((x) => picked.barcode && x.barcode === picked.barcode) ?? picked)}>Aggiungi alla mia lista</button>
      <button class="ghost" onClick=${() => setPicked(null)}>Indietro</button>`
    : mode === 'codice' ? html`
      <form onSubmit=${(e) => { e.preventDefault(); lookupBarcode(); }}>
        <label>Numero sotto il codice a barre<input inputmode="numeric" placeholder="es. 8004030044005" value=${text} onInput=${(e) => setText(e.target.value.replace(/\D/g, ''))} /></label>
        <button class="primary" disabled=${busy || text.length < 8}>${busy ? 'Cerco…' : 'Cerca il prodotto'}</button></form>
      ${err && html`<p class="warn small">${err}</p>`}`
    : mode === 'cerca' ? html`
      <form onSubmit=${(e) => { e.preventDefault(); search(); }}>
        <div class="row"><label>Marca<input placeholder="es. Rio Mare" value=${brand} onInput=${(e) => setBrand(e.target.value)} /></label>
          <label>Nome (facoltativo)<input placeholder="es. tonno" value=${text} onInput=${(e) => setText(e.target.value)} /></label></div>
        <button class="primary" disabled=${busy || brand.trim().length < 2}>${busy ? 'Cerco…' : 'Cerca'}</button></form>
      ${err && html`<p class="warn small">${err}</p>`}
      <ul class="results">${results.map((r) => html`<li><button onClick=${() => setPicked(fromOff(r))}>
        ${r.image_front_small_url && html`<img src=${r.image_front_small_url} alt="" loading="lazy" />`}
        <span>${r.product_name_it || r.product_name || 'Senza nome'}<small class="muted">${[].concat(r.brands ?? []).join(', ')} ${r.quantity ?? ''}</small></span></button></li>`)}</ul>
      <p class="muted small">I dati vengono da Open Food Facts. Se il prodotto non c'è, usa "Dall'etichetta".</p>`
    : html`
      <label>Nome e marca<input value=${manual.name} onInput=${(e) => setManual({ ...manual, name: e.target.value })} /></label>
      <div class="row"><label>Categoria<select value=${manual.category} onChange=${(e) => setManual({ ...manual, category: e.target.value })}>
        ${Object.entries(CATEGORIES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label>Confezione<input placeholder="es. 500 g" value=${manual.quantity} onInput=${(e) => setManual({ ...manual, quantity: e.target.value })} /></label></div>
      <p class="small muted">Valori per 100 g, come in etichetta:</p>
      <div class="grid2">${[['energyKcal', 'Energia (kcal)'], ['protein', 'Proteine'], ['carbs', 'Carboidrati'], ['sugars', 'di cui zuccheri'], ['fat', 'Grassi'], ['satFat', 'di cui saturi'], ['fiber', 'Fibre'], ['salt', 'Sale']].map(([k, l]) => html`
        <label>${l}<input inputmode="decimal" value=${manual[k]} onInput=${(e) => setManual({ ...manual, [k]: e.target.value })} /></label>`)}</div>
      <button class="primary" disabled=${!manual.name.trim() || manual.energyKcal === ''} onClick=${() => onAdd(manualProduct(manual))}>Aggiungi alla mia lista</button>`}
  <//>`;
}

// ───────────────────────── Shopping ─────────────────────────
function ShoppingTab({ profile, byId, updateProfile }) {
  if (!profile.plan) return html`<section class="card"><p>Genera prima il piano: la lista della spesa si crea da lì.</p></section>`;
  const list = shoppingList(profile.plan, byId);
  const checked = profile.shoppingChecked ?? {};
  const copy = () => navigator.clipboard?.writeText(list.filter((i) => !checked[i.id]).map((i) => `• ${i.name}: ${i.qty}`).join('\n'));
  return html`
    <p class="muted small">Quantità per i 7 giorni del piano. Spunta quello che hai già in casa o nel carrello.</p>
    ${Object.entries(CATEGORIES).map(([cat, label]) => {
      const items = list.filter((i) => i.category === cat);
      return items.length > 0 && html`<section class="card tight"><h3>${label}</h3><ul class="shop">${items.map((i) => html`
        <li class=${checked[i.id] ? 'done' : ''}><label><input type="checkbox" checked=${!!checked[i.id]}
          onChange=${() => updateProfile((p) => { p.shoppingChecked = { ...p.shoppingChecked, [i.id]: !checked[i.id] }; })} />
          <span>${i.name}<small class="muted">${i.qty}</small></span></label></li>`)}</ul></section>`;
    })}
    <button class="ghost" onClick=${copy}>Copia la lista (per WhatsApp o Note)</button>`;
}

// ───────────────────────── Weight ─────────────────────────
const BODY = [
  ['fatPct', 'Grasso corporeo', '%'],
  ['muscleKg', 'Massa muscolare', 'kg'],
  ['waterPct', 'Acqua', '%'],
  ['visceral', 'Grasso viscerale', 'livello'],
];

// Tesseract.js (OCR) is loaded only when a report is imported: about 10 MB the first time, then cached.
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement('script'), { src: TESSERACT_URL, onload: () => resolve(window.Tesseract), onerror: reject });
    document.head.append(el);
  });
}

function ReportImport({ onRead }) {
  const [status, setStatus] = useState('');
  const read = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      setStatus('Preparo la lettura (la prima volta serve qualche secondo in più)…');
      const Tesseract = await loadTesseract();
      setStatus('Leggo il referto…');
      const { data } = await Tesseract.recognize(file, 'eng');
      const values = parseFitdays(data.text);
      if (!values.kg) { setStatus('Non riesco a leggere il peso: usa la prima pagina del referto, quella con la tabella "Body composition analysis".'); return; }
      onRead(values);
      const missing = ['fatPct', 'muscleKg', 'waterPct', 'visceral'].filter((k) => values[k] == null).length;
      setStatus(missing ? 'Letto in parte: completa i campi vuoti, controlla e premi Registra.' : 'Valori letti: controllali e premi Registra.');
    } catch {
      setStatus('Lettura non riuscita. Serve la connessione la prima volta; altrimenti inserisci i valori a mano.');
    }
  };
  return html`<label class="ghost filebtn">📷 Importa referto Fitdays<input type="file" accept="image/*" onChange=${read} /></label>
    ${status && html`<p class="small muted">${status}</p>`}`;
}

function WeightTab({ profile, updateProfile }) {
  const [kg, setKg] = useState('');
  const [date, setDate] = useState(today());
  const [body, setBody] = useState({});
  const [showBody, setShowBody] = useState(false);
  const [metric, setMetric] = useState('kg');
  const weights = [...(profile.weights ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const add = () => {
    const v = num(kg);
    if (!v || v < 30 || v > 300) return;
    const extra = Object.fromEntries(BODY.map(([k]) => [k, num(body[k] ?? '')]).filter(([, x]) => x !== '' && !Number.isNaN(x)));
    updateProfile((p) => {
      p.weights = [...(p.weights ?? []).filter((w) => w.date !== date), { date, kg: v, ...extra }].sort((a, b) => a.date.localeCompare(b.date));
      p.weightKg = p.weights.at(-1).kg;
    });
    setKg('');
    setBody({});
  };
  const first = weights[0], last = weights.at(-1);
  const trend = weeklyTrend(weights);
  const withFat = weights.filter((w) => w.fatPct != null);
  const metrics = [['kg', 'Peso', 'kg'], ...(withFat.length >= 2 ? [['fatKg', 'Massa grassa', 'kg']] : []), ...BODY.filter(([k]) => weights.filter((w) => w[k] != null).length >= 2)];
  const [, metricLabel, metricUnit] = metrics.find(([k]) => k === metric) ?? metrics[0];
  const valueOf = (w) => (metric === 'fatKg' ? (w.fatPct != null ? Math.round(w.kg * w.fatPct) / 100 : null) : w[metric]);
  const series = weights.filter((w) => valueOf(w) != null).map((w) => ({ date: w.date, kg: valueOf(w) }));
  const fatFirst = withFat[0], fatLast = withFat.at(-1);
  const fromReport = (v) => {
    setKg(String(v.kg));
    if (v.date && v.date <= today()) setDate(v.date);
    setBody(Object.fromEntries(BODY.filter(([k]) => v[k] != null).map(([k]) => [k, String(v[k])])));
    setShowBody(true);
  };
  return html`
    <section class="card">
      <${ReportImport} onRead=${fromReport} />
      <div class="row">
        <label>Peso (kg)<input type="number" inputmode="decimal" step="0.1" value=${kg} onInput=${(e) => setKg(e.target.value)} placeholder=${last?.kg ?? ''} /></label>
        <label>Data<input type="date" value=${date} max=${today()} onInput=${(e) => setDate(e.target.value)} /></label>
      </div>
      <label class="check"><input type="checkbox" checked=${showBody} onChange=${(e) => setShowBody(e.target.checked)} /> Aggiungi i dati della bilancia impedenziometrica</label>
      ${showBody && html`<div class="grid2">${BODY.map(([k, l, u]) => html`
        <label>${l} (${u})<input type="number" inputmode="decimal" step="0.1" value=${body[k] ?? ''} onInput=${(e) => setBody({ ...body, [k]: e.target.value })} /></label>`)}</div>`}
      <button class="primary" onClick=${add}>Registra</button>
      <p class="muted small">Pesati alla stessa ora, al mattino a digiuno. Se registri due volte lo stesso giorno, vale l'ultima. Al rientro da un volo è normale vedere 0,5-1 kg in più per i liquidi trattenuti: conta l'andamento, non il singolo giorno.</p>
    </section>
    ${weights.length > 0 && html`<section class="card">
      <div class="stats">
        <div><small class="muted">Inizio</small><b>${dec(first.kg)} kg</b></div>
        <div><small class="muted">Oggi</small><b>${dec(last.kg)} kg</b></div>
        <div><small class="muted">Variazione</small><b>${(last.kg - first.kg > 0 ? '+' : '') + dec(last.kg - first.kg)} kg</b></div>
        <div><small class="muted">Obiettivo</small><b>${profile.goalKg} kg</b></div>
      </div>
      ${withFat.length >= 2 && html`<p class="small">Massa grassa: da ${dec(fatFirst.kg * fatFirst.fatPct / 100)} a ${dec(fatLast.kg * fatLast.fatPct / 100)} kg (<b>${dec((fatLast.kg * fatLast.fatPct - fatFirst.kg * fatFirst.fatPct) / 100)} kg</b>). È il numero che conta davvero: il peso oscilla con l'acqua, il grasso no.</p>`}
      ${metrics.length > 1 && html`<div class="segmented">${metrics.map(([k, l]) => html`<button class=${metric === k ? 'on' : ''} onClick=${() => setMetric(k)}>${l}</button>`)}</div>`}
      ${series.length > 1 && html`<${WeightChart} weights=${series} goal=${metric === 'kg' ? profile.goalKg : null} unit=${metricUnit} label=${metricLabel} />`}
      ${trend != null && html`<p class="small">Andamento delle ultime settimane: <b>${trend > 0 ? '+' : ''}${trend.toFixed(2).replace('.', ',')} kg a settimana</b>.</p>`}
    </section>
    <section class="card tight"><h3>Storico</h3><ul class="plist">${[...weights].reverse().map((w) => html`<li class="wrow">
      <span>${new Date(w.date + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
        ${BODY.some(([k]) => w[k] != null) && html`<small class="muted">${BODY.filter(([k]) => w[k] != null).map(([k, l, u]) => `${l} ${dec(w[k])}${u === 'livello' ? '' : ' ' + u}`).join(' · ')}</small>`}</span>
      <b>${dec(w.kg)} kg</b>
      <button class="ghost small" aria-label="Elimina" onClick=${() => confirm('Eliminare questa pesata?') && updateProfile((p) => { p.weights = p.weights.filter((x) => x.date !== w.date); if (p.weights.length) p.weightKg = p.weights.at(-1).kg; })}>✕</button></li>`)}</ul></section>`}`;
}

/** Least-squares slope over the last 28 days, in kg per week. */
function weeklyTrend(weights) {
  const cutoff = Date.now() - 28 * 864e5;
  const pts = weights.map((w) => [new Date(w.date).getTime() / 864e5, w.kg]).filter(([d]) => d * 864e5 >= cutoff);
  if (pts.length < 3) return null;
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length, my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const num_ = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), den = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return den ? (num_ / den) * 7 : null;
}

function WeightChart({ weights, goal, unit = 'kg', label = 'Peso' }) {
  const W = 320, H = 160, P = { l: 34, r: 8, t: 10, b: 22 };
  const xs = weights.map((w) => new Date(w.date).getTime());
  const ys = weights.map((w) => w.kg);
  const minY = Math.floor(Math.min(...ys, goal ?? Infinity) - 1), maxY = Math.ceil(Math.max(...ys) + 1);
  const x = (t) => P.l + ((t - xs[0]) / Math.max(1, xs.at(-1) - xs[0])) * (W - P.l - P.r);
  const y = (v) => P.t + ((maxY - v) / (maxY - minY)) * (H - P.t - P.b);
  const ticks = [minY, Math.round((minY + maxY) / 2), maxY];
  const fmt = (t) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Andamento: ${label}`}>
    ${ticks.map((v) => html`<line x1=${P.l} x2=${W - P.r} y1=${y(v)} y2=${y(v)} class="grid" /><text x=${P.l - 6} y=${y(v) + 4} text-anchor="end">${v}</text>`)}
    ${goal && goal >= minY && html`<line x1=${P.l} x2=${W - P.r} y1=${y(goal)} y2=${y(goal)} class="goal" /><text x=${W - P.r} y=${y(goal) - 4} text-anchor="end" class="goal-label">obiettivo</text>`}
    <polyline points=${weights.map((w, i) => `${x(xs[i])},${y(w.kg)}`).join(' ')} class="line" />
    ${weights.map((w, i) => html`<circle cx=${x(xs[i])} cy=${y(w.kg)} r="3" class="pt"><title>${fmt(xs[i])}: ${dec(w.kg)} ${unit}</title></circle>`)}
    <text x=${P.l} y=${H - 6}>${fmt(xs[0])}</text><text x=${W - P.r} y=${H - 6} text-anchor="end">${fmt(xs.at(-1))}</text>
  </svg>`;
}

// ───────────────────────── Profile ─────────────────────────
function WeightSummary({ profile }) {
  const w = [...(profile.weights ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  if (!w.length) return null;
  return html`<div class="stats">
    <div><small class="muted">Peso iniziale (${fmt(w[0].date)})</small><b>${dec(w[0].kg)} kg</b></div>
    <div><small class="muted">Peso attuale (${fmt(w.at(-1).date)})</small><b>${dec(w.at(-1).kg)} kg</b></div>
  </div>
  <p class="muted small">Il peso si aggiorna dalla scheda Peso: il fabbisogno viene ricalcolato sull'ultima pesata.</p>`;
}

function ProfileTab({ state, profile, targets, update, updateProfile }) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile.id]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const importFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => {
      const data = JSON.parse(t);
      if (!Array.isArray(data.profiles)) throw new Error();
      if (confirm('Sostituire tutti i dati di questo dispositivo con il backup?')) update(() => ({ ...emptyState(), ...data }));
    }).catch(() => alert('File non valido.'));
  };
  return html`
    <section class="card">
      <h2>Il tuo fabbisogno</h2>
      ${targets.warnings.map((w) => html`<p class="warn">${w}</p>`)}
      <div class="stats">
        <div><small class="muted">Metabolismo basale</small><b>${targets.bmr} kcal</b></div>
        <div><small class="muted">Consumo giornaliero</small><b>${targets.tdee} kcal</b></div>
        <div><small class="muted">Obiettivo</small><b>${targets.kcal} kcal</b></div>
        <div><small class="muted">IMC</small><b>${dec(targets.bmi)}</b></div>
      </div>
      <p class="small">Proteine <b>${targets.protein} g</b> · Carboidrati <b>${targets.carbs} g</b> · Grassi <b>${targets.fat} g</b> · Fibre <b>${targets.fiber} g</b></p>
      <p class="muted small">Calo atteso: circa ${targets.weeklyLoss.toFixed(2).replace('.', ',')} kg a settimana. Metabolismo calcolato con la formula ${targets.bmrMethod}; proteine a 1,6 g per kg di peso di riferimento per preservare i muscoli in deficit.</p>
      ${profile.medical && html`<p class="warn small">Hai indicato condizioni mediche: mostra questo piano al tuo medico prima di seguirlo.</p>`}
    </section>
    <section class="card">
      <h2>Dati</h2>
      <${WeightSummary} profile=${profile} />
      <${ProfileFields} p=${draft} set=${setDraft} editWeight=${false} />
      <${HabitFields} p=${draft} set=${setDraft} />
      <button class="primary" disabled=${!dirty} onClick=${() => updateProfile((p) => Object.assign(p, draft))}>Salva</button>
      ${dirty && html`<p class="muted small">Dopo aver salvato, genera un nuovo piano per aggiornare le porzioni.</p>`}
    </section>
    <section class="card">
      <h2>Persone</h2>
      <ul class="plist">${state.profiles.map((p) => html`<li class="wrow"><span>${p.name}${p.id === state.activeId ? ' (attivo)' : ''}</span>
        ${p.id !== state.activeId && html`<button class="ghost small" onClick=${() => update((s) => { s.activeId = p.id; })}>Usa</button>`}</li>`)}</ul>
      <button class="ghost" onClick=${() => update((s) => { s.household.mode = 'coppia'; s.activeId = null; })}>＋ Aggiungi una persona</button>
      <p class="muted small">Ogni persona ha la sua lista di prodotti, il suo piano e il suo peso. La dispensa è in comune. La sincronizzazione tra due telefoni arriverà nella fase 2.</p>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="muted small">I dati restano solo su questo dispositivo. Esporta un backup ogni tanto, o per spostarli dal Mac all'iPhone.</p>
      <button class="ghost" onClick=${() => exportJson(state)}>Esporta backup</button>
      <label class="ghost filebtn">Importa backup<input type="file" accept="application/json" onChange=${importFile} /></label>
    </section>`;
}

render(html`<${App} />`, document.getElementById('app'));
