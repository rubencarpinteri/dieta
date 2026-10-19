import { html, render, useState, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';
import { load, save, exportJson, uid, today, emptyState } from './store.js';
import { qualityScore } from './lib/scoring.js';
import { ADDITIVES } from './lib/additives.js';
import { dailyTargets, ageFrom, ACTIVITY, PACE } from './lib/targets.js';
import {
  generateWeek, changeDayType, dayTotals, nutrientsOf, supplementAdvice, dayAdvice, substitutes, substitute, revertSubstitute, compensation, compensate, undoCompensate, redoCompensate, rebalanceSuggestion, moreProtein, richerAlternative, dismissSuggestion, resetMeal, addIngredient, removeAdded, setQuantity, snapshotMeal, applySaved, productRole, eligibleRecipes, alternatives, editDay, setMeal, toggleSkip, setDone, eatOut, undoEatOut, addExtra, removeExtra,
  MEAL_ORDER, MEAL_LABEL, mealLabel, mealKeys, skipMeal, unskipMeal, addSnack, removeMeal, fiberSuggestion, FASTING, DAY_TYPES, DEFAULT_ONBOARD,
} from './lib/planner.js';
import { PRESETS } from './lib/presets.js';
import { RECIPES } from './lib/recipes.js';
import { formatQty, unitsFor, addDefault, pieceUnit } from './lib/units.js';
import { shoppingList } from './lib/shopping.js';
import { searchProducts, productByBarcode, fromOff, manualProduct } from './lib/off.js';
import { parseFitdays } from './lib/fitdays.js';
import * as sync from './sync.js';
import { Icon } from './icons.js';

const CATEGORIES = {
  proteine: 'Carne, pesce, uova e salumi', cereali: 'Pasta, riso, pane e cracker', latticini: 'Latte, formaggi e dessert proteici',
  verdure: 'Verdure', frutta: 'Frutta', frutta_secca: 'Frutta secca', condimenti: 'Condimenti e salse',
  aromi: 'Spezie e aromi', dolci: 'Dolci e biscotti', pronti: 'Piatti pronti',
};
const METHOD = { microonde: 'Microonde', friggitrice: 'Friggitrice ad aria', padella: 'Padella', pentola: 'Pentola', nessuna: 'Senza cottura' };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const recipeById = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const r0 = (n) => Math.round(n);
const dec = (n) => (Math.round(n * 10) / 10).toLocaleString('it-IT');

// ───────────────────────── Sync ─────────────────────────
const sharedJson = (s) => JSON.stringify({ mode: s.household.mode, customProducts: s.customProducts });

function stamp(prev, next) {
  const now = Date.now();
  const before = Object.fromEntries(prev.profiles.map((p) => [p.id, JSON.stringify(p)]));
  next.profiles = next.profiles.map((p) => (before[p.id] === JSON.stringify(p) ? p : { ...p, updatedAt: now }));
  if (sharedJson(prev) !== sharedJson(next)) next.sharedUpdatedAt = now;
  return next;
}

/** Keeps this device and Firestore in step. Remote changes are applied without re-stamping. */
function useSync(state, setState) {
  const [info, setInfo] = useState({ status: state.sync?.hid ? 'connecting' : 'off' });
  const sent = useRef({});
  const ready = useRef({ profiles: false, shared: false });
  const hid = state.sync?.hid;

  useEffect(() => {
    if (!hid || !sync.syncAvailable()) { setInfo({ status: 'off' }); return undefined; }
    let stopListen = () => {};
    let stopUser = () => {};
    let alive = true;
    sent.current = {};
    ready.current = { profiles: false, shared: false };
    setInfo({ status: 'connecting', stage: 'accesso', since: Date.now() });
    sync.onUser(async (user) => {
      stopListen();
      stopListen = () => {};
      if (!alive) return;
      if (!user || user.uid !== state.sync.uid) { setInfo({ status: 'signedout' }); return; }
      setInfo((x) => ({ ...x, status: 'connecting', stage: 'profili', since: x.since ?? Date.now() }));
      // Profiles can use products added by hand, which travel with the shared household data:
      // apply them only once that has arrived, so a new device never sees a plan with unknown products.
      let pending = null;
      const handlers = {
        onProfiles: (docs) => {
          if (!ready.current.shared) { pending = docs; return; }
          setState((s) => {
            // Other people's profiles stay private: drop any copy this device still has from before.
            const profiles = s.profiles.filter((p) => !p.owner || p.owner === s.sync?.uid);
            for (const d of docs) {
              const i = profiles.findIndex((p) => p.id === d.data.id);
              const local = profiles[i];
              if (!local || (d.data.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
                if (i < 0) profiles.push(d.data); else profiles[i] = d.data;
              }
              sent.current[d.data.id] = JSON.stringify(d.data);
            }
            // Open this account's own profile. Someone who just joined has none yet: no active profile
            // means the app asks them to create theirs instead of showing someone else's plan.
            const mine = profiles[0];
            const activeId = profiles.some((p) => p.id === s.activeId) ? s.activeId : mine?.id ?? null;
            return { ...s, profiles, activeId };
          });
          ready.current.profiles = true;
          setInfo((x) => ({ ...x, status: 'ok', at: Date.now() }));
        },
        onShared: (d) => {
          setState((s) => {
            // Products are only ever added, so both lists are kept: nothing added on either side gets lost.
            const remote = d.customProducts ?? [];
            const customProducts = [...remote, ...s.customProducts.filter((x) => !remote.some((y) => y.id === x.id))];
            const newer = (d.updatedAt ?? 0) > (s.sharedUpdatedAt ?? 0);
            return {
              ...s, customProducts,
              household: newer ? { ...s.household, mode: d.mode ?? s.household.mode } : s.household,
              sharedUpdatedAt: newer ? d.updatedAt : s.sharedUpdatedAt,
            };
          });
          sent.current.shared = JSON.stringify({ mode: d.mode, customProducts: d.customProducts ?? [] });
          ready.current.shared = true;
          if (pending) { const docs = pending; pending = null; handlers.onProfiles(docs); }
        },
        onError: (e) => setInfo({ status: 'error', detail: e?.code ?? String(e) }),
      };
      const off = await sync.listen(hid, user.uid, handlers);
      if (alive) stopListen = off; else { off(); return; }
      // Plan B: if the live connection delivers nothing within a few seconds (it happens in Safari on
      // iPhone), read the same data with a plain web request. Live updates keep trying in the background.
      const backup = setTimeout(async () => {
        if (!alive || ready.current.profiles) return;
        setInfo((x) => ({ ...x, stage: 'riserva' }));
        try {
          const token = await user.getIdToken();
          const [docs, shared] = await Promise.all([sync.restProfiles(hid, user.uid, token), sync.restShared(hid, token)]);
          if (!alive || ready.current.profiles) return;
          if (shared) handlers.onShared(shared);
          handlers.onProfiles(docs);
        } catch (e) {
          if (alive) setInfo((x) => ({ ...x, detail: e?.message ?? String(e) }));
        }
      }, 5000);
      const stop = stopListen;
      stopListen = () => { clearTimeout(backup); stop(); };
    }).then((unsub) => { if (alive) stopUser = unsub; else unsub(); })
      .catch(() => setInfo({ status: 'error' }));
    return () => { alive = false; stopListen(); stopUser(); };
  }, [hid]);

  // Send local changes a moment after they happen (only once the remote state has been read).
  useEffect(() => {
    if (!hid || !ready.current.profiles || !ready.current.shared) return undefined;
    const t = setTimeout(async () => {
      try {
        for (const p of state.profiles) {
          if (p.owner && p.owner !== state.sync.uid) continue;
          const json = JSON.stringify(p);
          if (sent.current[p.id] !== json) { await sync.pushProfile(hid, p); sent.current[p.id] = json; }
        }
        const shared = sharedJson(state);
        if (sent.current.shared !== shared) { await sync.pushShared(hid, state); sent.current.shared = shared; }
        setInfo({ status: 'ok', at: Date.now() });
      } catch {
        setInfo({ status: 'error' });
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [state, hid, info.status]);

  return info;
}

function SyncPanel({ state, setState, syncInfo, compact = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!sync.syncAvailable()) return null;

  const run = async (fn) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg(sync.syncError(e)); } setBusy(false); };
  const connect = (hid, u, replaceLocal) => setState((s) => {
    const profiles = replaceLocal ? [] : s.profiles.filter((p) => !p.owner || p.owner === u.uid).map((p) => ({ ...p, owner: p.owner ?? u.uid }));
    const mine = profiles.find((p) => p.owner === u.uid);
    return { ...s, sync: { uid: u.uid, email: u.email, hid }, profiles, activeId: mine?.id ?? null };
  });

  const login = (create) => run(async () => {
    const u = await sync.signIn(email, password, create);
    setPassword('');
    if (code.trim()) {
      // Joining someone else's household: this device's profiles (if any) are added to it.
      // The shared message is "Codice per l'app Dieta: <id>": keep only the 20-character id.
      const hid = code.match(/[A-Za-z0-9]{20}/)?.[0] ?? code.trim();
      await sync.joinHousehold(u.uid, hid);
      connect(hid, u, false);
      return;
    }
    const hid = await sync.householdOf(u.uid);
    if (hid) {
      const replace = state.profiles.length > 0 && confirm('Questo account ha già dei dati sincronizzati. Vuoi usare quelli e sostituire i dati di questo dispositivo?\n\nAnnulla = tieni anche i dati di questo dispositivo e uniscili.');
      connect(hid, u, replace);
    } else {
      // First time for this account: its household starts from this device's data (possibly empty).
      const owned = { ...state, profiles: state.profiles.map((p) => ({ ...p, owner: p.owner ?? u.uid, updatedAt: p.updatedAt ?? Date.now() })) };
      connect(await sync.createHousehold(u.uid, owned), u, false);
    }
  });

  if (state.sync?.hid) {
    const label = { ok: '✓ Sincronizzato', connecting: 'Connessione…', error: 'Offline: sincronizzo appena torna la rete', signedout: 'Sessione scaduta: esci e accedi di nuovo', off: '' }[syncInfo.status];
    const share = () => (navigator.share ? navigator.share({ text: `Codice per l'app Dieta: ${state.sync.hid}` }) : navigator.clipboard?.writeText(state.sync.hid));
    return html`<details class="card group"><summary><h3>Sincronizzazione</h3><span class="count">${label}</span></summary>
      <p><b>${label}</b>${syncInfo.at ? html` <small class="muted">ultimo aggiornamento alle ${new Date(syncInfo.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</small>` : ''}</p>
      <p class="small muted">Account: ${state.sync.email}. Le modifiche arrivano sugli altri dispositivi in pochi secondi.</p>
      <p class="small">Per aggiungere un'altra persona (es. tua moglie): sul suo telefono crea un account e inserisci questo codice.</p>
      <p class="code">${state.sync.hid}</p>
      <button class="ghost" onClick=${share}>Condividi il codice</button>
      <button class="ghost" onClick=${() => confirm('Uscire? I dati restano su questo dispositivo ma non verranno più sincronizzati.') && sync.signOut().finally(() => setState((s) => ({ ...s, sync: null })))}>Esci dall'account</button>
    </details>`;
  }

  return html`<section class="card"><h2>${compact ? 'Hai un account o un codice?' : 'Sincronizzazione tra dispositivi'}</h2>
    <p class="small muted">${compact
      ? 'Accedi per ritrovare i dati che usi già su un altro dispositivo, oppure entra nella dispensa di casa con il codice che ti hanno dato.'
      : 'Crea un account per avere gli stessi dati su Mac e iPhone, aggiornati da soli. Lo stesso account si usa su tutti i tuoi dispositivi.'}</p>
    <details open=${!!code}><summary class="small">Mi hanno dato un codice per unirmi</summary>
      <label>Codice<input value=${code} onInput=${(e) => setCode(e.target.value)} autocapitalize="off" autocorrect="off" spellcheck=${false} /></label>
      <p class="small muted">Con il codice entri nella dispensa di chi te l'ha dato: ognuno ha comunque il suo profilo e il suo piano.</p>
    </details>
    ${code.trim() && html`<p class="small"><b>Ora scegli la tua email e una password qui sotto, poi premi "Crea account"</b> (o "Accedi" se hai già un account dell'app).</p>`}
    <label>Email<input type="email" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
    <label>Password${!compact || code.trim() ? ' (almeno 6 caratteri)' : ''}<input type="password" autocomplete=${compact && !code.trim() ? 'current-password' : 'new-password'} value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
    <div class="row">
      <button class="primary" disabled=${busy || !email || !password} onClick=${() => login(false)}>${busy ? '…' : 'Accedi'}</button>
      <button class=${code.trim() ? 'primary' : 'ghost'} disabled=${busy || !email || password.length < 6} onClick=${() => login(true)}>Crea account</button>
    </div>
    ${(!email || !password) && html`<p class="small muted">I pulsanti si attivano quando hai scritto email e password.</p>`}
    ${msg && html`<p class="warn small">${msg}</p>`}
  </section>`;
}

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
  // Every local change stamps what it touched, so sync knows which version is the newest.
  const update = (fn) => setState((s) => { const copy = structuredClone(s); return stamp(s, fn(copy) ?? copy); });
  const syncInfo = useSync(state, setState);
  const updateProfile = (fn) => update((s) => { fn(s.profiles.find((p) => p.id === s.activeId), s); });

  if (error) return html`<main class="center"><p>${error}</p></main>`;
  if (!base) return html`<main class="center"><p class="muted">Caricamento…</p></main>`;
  if (!profile && state.sync?.hid && syncInfo.status === 'connecting' && !state.profiles.length) {
    return html`<${Downloading} syncInfo=${syncInfo} setState=${setState} />`;
  }
  if (!profile) return html`<${Onboarding} state=${state} base=${base} setState=${setState} update=${update} syncInfo=${syncInfo} onDone=${(p, mode) => update((s) => {
    if (mode) s.household.mode = mode;
    if (s.sync?.uid) p.owner = s.sync.uid;
    s.profiles.push(p); s.activeId = p.id;
  })} onImport=${(data) => update(() => data)} onCancel=${state.profiles.length ? () => update((s) => { s.activeId = s.profiles[0].id; }) : null} />`;

  const targets = dailyTargets({ ...profile, age: ageFrom(profile.birthYear) });
  const ctx = { state, profile, products, byId, targets, update, updateProfile, setState, syncInfo };
  const TABS = [['piano', 'calendar', 'Piano'], ['prodotti', 'basket', 'Prodotti'], ['spesa', 'checklist', 'Spesa'], ['peso', 'scale', 'Peso'], ['profilo', 'person', 'Profilo']];

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
      ${TABS.map(([id, icon, label]) => html`<button class=${tab === id ? 'on' : ''} aria-current=${tab === id ? 'page' : undefined} onClick=${() => { setTab(id); scrollTo(0, 0); }}>
        <${Icon} name=${icon} size=${24} /><span>${label}</span></button>`)}
    </nav>`;
}

/** Shown while a new device downloads its data. After a while it explains and offers a way out. */
function Downloading({ syncInfo, setState }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const slow = Date.now() - (syncInfo.since ?? Date.now()) > 15000;
  const restart = () => sync.signOut().finally(() => setState((s) => ({ ...s, sync: null })));
  return html`<main class="center"><section class="card">
    <p class="muted">${{ accesso: 'Accesso in corso…', profili: 'Scarico i tuoi dati…', riserva: 'Scarico i tuoi dati (secondo tentativo)…' }[syncInfo.stage] ?? 'Scarico i tuoi dati…'}</p>
    ${slow && html`<p class="small">Ci sta mettendo troppo. Controlla di essere online, poi riprova.</p>`}
    <button class=${slow ? 'primary' : 'ghost'} onClick=${() => location.reload()}>Riprova</button>
    <button class="ghost" onClick=${restart}>Esci e accedi di nuovo</button>
    <p class="small muted">Dettagli: ${syncInfo.stage ?? '-'} · ${Math.round((Date.now() - (syncInfo.since ?? Date.now())) / 1000)} s${syncInfo.detail ? ` · ${syncInfo.detail}` : ''} · v34</p>
  </section></main>`;
}

/** Read a backup exported from another device. Rejects anything that is not one of our backups. */
async function readBackup(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.profiles) || !data.profiles.length) throw new Error('not a backup');
  return { ...emptyState(), ...data, activeId: data.activeId ?? data.profiles[0].id };
}

// ───────────────────────── Onboarding / profile form ─────────────────────────
const blankProfile = () => ({
  id: uid(), name: '', sex: 'M', birthYear: 1990, heightCm: 175, weightKg: 80, goalKg: 72, activity: 'leggero', pace: 0.5,
  pregnant: false, medical: false, medicalNote: '', fasting: 'nessuno', cooking: 'momento', microwaveW: 800,
  overnight: false, onboard: DEFAULT_ONBOARD,
  approved: [], dayTypes: Array(7).fill('casa'), plan: null, weights: [], shoppingChecked: {},
});

function Onboarding({ state, base, onDone, onCancel, onImport, setState, syncInfo }) {
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
    </section>
    <${SyncPanel} state=${state} setState=${setState} syncInfo=${syncInfo} compact=${true} />
    <section class="card">
      <h2>Usi già l'app su un altro dispositivo?</h2>
      <p class="small muted">Sull'altro dispositivo vai in Profilo → Esporta backup e manda il file qui (su iPhone con AirDrop o salvandolo in File). Poi sceglilo qui sotto: ritrovi profilo, prodotti, piano e pesate.</p>
      <label class="ghost filebtn">Importa un backup<input type="file" accept="application/json,.json" onChange=${(e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) readBackup(file).then(onImport).catch(() => alert('Questo file non è un backup dell\'app Dieta.'));
      }} /></label>
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
    <p class="muted small">Nei giorni di volo il piano aggiunge un pasto a bordo, scelto solo tra questi; gli altri pasti della giornata diventano un po' più leggeri. Se non ne spunti nessuno, userò qualsiasi pasto da portare.</p>`;
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
  // One sheet at a time: { kind, meal, … }
  const [sheet, setSheet] = useState(null);
  const [tipSeen, setTipSeen] = useState(() => { try { return localStorage.getItem('dieta:tip') === '1'; } catch { return false; } });
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
      <button class="primary" onClick=${newPlan}>Genera il piano della settimana</button>
    </section>`;

  const current = plan.days[day];
  const totals = dayTotals(current);
  const avg = plan.days.map(dayTotals).reduce((a, t) => { for (const k in t) a[k] = (a[k] ?? 0) + t[k] / 7; return a; }, {});
  const advice = supplementAdvice(avg, targets);
  const room = targets.kcal - totals.kcal;

  const edit = (change) => updateProfile((p) => { p.plan = editDay(p.plan, day, change, opts, byId); });
  const over = totals.kcal - targets.kcal;
  const ateOut = Object.values(current.meals).some((m) => m?.external) || (current.extras ?? []).length > 0;
  const changedToday = ateOut || Object.values(current.meals).some((m) => m?.skipped?.length || m?.custom);
  const suggestion = rebalanceSuggestion(current, byId, targets);
  const suggestionKey = suggestion && `${suggestion.meal}:${suggestion.missing.join(',')}:${Math.round(suggestion.deficit.protein / 5)}:${Math.round(suggestion.deficit.fiber / 3)}`;
  const showSuggestion = suggestion && !current.dismissed?.[suggestionKey];
  const dayNotes = changedToday ? dayAdvice(totals, targets)
    .filter((a) => !(showSuggestion && ((a.title.startsWith('Proteine') && suggestion.missing.includes('protein')) || (a.title.startsWith('Fibre') && suggestion.missing.includes('fiber'))))) : [];

  const setDayType = (type) => updateProfile((p) => {
    p.dayTypes[day] = type;
    p.plan = changeDayType(p.plan, day, type, opts, byId);
  });
  const close = () => setSheet(null);
  const hideTip = () => { setTipSeen(true); try { localStorage.setItem('dieta:tip', '1'); } catch { /* private mode */ } };
  const stale = !plan.targetKcal || Math.abs(plan.targetKcal - targets.kcal) > 50;

  return html`<div class="plan">
    <div class="p-day">
      ${targets.warnings.map((w) => html`<details class="mini-note"><summary><${Icon} name="lightbulb" size=${15} /> ${w.split(':')[0]}</summary><p class="small">${w}</p></details>`)}
      ${stale && html`<p class="warn small">Il piano è stato creato per ${plan.targetKcal ?? 'un altro'} kcal, ora il tuo obiettivo è ${targets.kcal}: <button class="link" onClick=${() => confirm('Generare un nuovo piano per i prossimi 7 giorni?') && newPlan()}>rigeneralo</button>.</p>`}
      <div class="days">${plan.days.map((_, i) => { const l = dayLabel(plan, i); return html`
        <button class=${i === day ? 'on' : ''} onClick=${() => { setDay(i); close(); }}>
          <small>${l.short}</small><b>${l.date}</b>${plan.days[i].type !== 'casa' && html`<span class="dot" title="Giorno di volo"><${Icon} name="plane" size=${12} label="Volo" /></span>`}</button>`; })}</div>
      <section class="card tight">
        <div class="segmented">${Object.entries(DAY_TYPES).filter(([k]) => k !== 'pernotto' || profile.overnight || current.type === k).map(([k, t]) => html`
          <button class=${current.type === k ? 'on' : ''} onClick=${() => current.type !== k && setDayType(k)}>${t.label}</button>`)}</div>
        <${Totals} totals=${totals} targets=${targets} />
        ${dayNotes.length > 0 && html`<details class="mini-note"><summary><${Icon} name="pill" size=${15} /> Consigli di oggi: ${dayNotes.map((a) => a.title.replace(' di oggi', '').toLowerCase()).join(', ')}</summary>
          ${dayNotes.map((a) => html`<div class="small note-inline"><b>${a.title}.</b> ${a.text}
            ${a.key === 'fiber' && html`<${FiberTip} day=${current} approved=${approved} byId=${byId} edit=${edit} />`}</div>`)}</details>`}
        ${(current.extras ?? []).length > 0 && html`<div class="extras">
          ${current.extras.map((e) => html`<span class="chip">${e.name} · ${r0(e.kcal)} kcal <button aria-label="Rimuovi" onClick=${() => edit(removeExtra(e.uid))}>✕</button></span>`)}</div>`}
        ${over > targets.kcal * 0.05 && ateOut && html`<p class="small muted">Oggi sei sopra di circa ${r0(over)} kcal: ogni tanto va bene, conta la settimana. Domani riprendi il piano senza saltare pasti.</p>`}
      </section>
    </div>

    <div class="p-meals">
      ${!tipSeen && html`<p class="tip small"><${Icon} name="lightbulb" size=${16} /> Tocca il <b>nome</b> di un ingrediente per toglierlo, la <b>quantità</b> per cambiarla. Il resto della giornata si ricalcola da solo. <button class="link" onClick=${hideTip}>Ok, capito</button></p>`}
      ${mealKeys(current).map((meal) => html`<${MealCard} key=${meal} meal=${meal} m=${current.meals[meal]} byId=${byId} approved=${approved}
        profile=${profile} edit=${edit} open=${(kind, extra = {}) => setSheet({ kind, meal, ...extra })}
        suggestion=${showSuggestion && suggestion.meal === meal ? suggestion : null}
        rebalance=${showSuggestion && suggestion.meal === meal && html`<${RebalanceCard} s=${suggestion} m=${current.meals[meal]} meal=${meal} plan=${plan} day=${day} opts=${opts} byId=${byId}
          edit=${edit} onDismiss=${() => edit(dismissSuggestion(suggestionKey))} />`} />`)}
      <div class="add-row">
          <button class="ghost small" onClick=${() => {
            const options = alternatives(plan, day, 'spuntino', opts, byId).filter((a) => a.fitsBudget);
            const pick = options[Math.floor(Math.random() * Math.min(options.length, 6))];
            if (pick) edit(addSnack(pick.meal));
          }}><${Icon} name="plus" size=${16} /> Spuntino</button>
        <button class="ghost small" onClick=${() => setSheet({ kind: 'out', extra: true })}><${Icon} name="plus" size=${16} /> Fuori piano</button>
      </div>
    </div>

    <div class="p-week">
      ${advice.length > 0 && html`<details class="card note"><summary><b><${Icon} name="pill" size=${16} /> Integratori consigliati per la settimana</b></summary>
        ${advice.map((a) => html`<p class="small"><b>${a.title}.</b> ${a.text}</p>`)}
        <p class="muted small">Suggerimenti generali: se hai condizioni mediche, chiedi prima al medico o al farmacista.</p></details>`}
      <section class="card tight">
        <p class="small muted">Media della settimana: ${r0(avg.kcal)} kcal</p><${MacroDots} t=${avg} />
        <button class="ghost" onClick=${() => confirm('Generare un nuovo piano per i prossimi 7 giorni?') && newPlan()}>Genera un nuovo piano</button>
      </section>
    </div>

    ${sheet?.kind === 'menu' && html`<${MealMenu} meal=${sheet.meal} m=${current.meals[sheet.meal]} onClose=${close}
      onPick=${(kind) => setSheet({ kind, meal: sheet.meal })} onReset=${() => { edit(resetMeal(sheet.meal)); close(); }}
      onSkip=${() => { edit(skipMeal(sheet.meal)); close(); }} onRemove=${() => { edit(removeMeal(sheet.meal)); close(); }} />`}
    ${sheet?.kind === 'save' && current.meals[sheet.meal] && html`<${SaveMealSheet} m=${current.meals[sheet.meal]} byId=${byId} onClose=${close}
      onSave=${(name) => { updateProfile((p) => { p.savedMeals = [...(p.savedMeals ?? []), { id: uid(), name, ...snapshotMeal(current.meals[sheet.meal]), createdAt: today() }]; }); close(); }} />`}
    ${sheet?.kind === 'saved' && html`<${SavedMealsSheet} meal=${sheet.meal} saved=${profile.savedMeals ?? []} byId=${byId} approved=${approved} updateProfile=${updateProfile} onClose=${close}
      onPick=${(saved) => { edit(applySaved(sheet.meal, saved, byId)); close(); }}
      onCreate=${(saved, putNow) => {
        updateProfile((p) => { p.savedMeals = [...(p.savedMeals ?? []), saved]; });
        if (putNow) edit(applySaved(sheet.meal, saved, byId));
        close();
      }} />`}
    ${sheet?.kind === 'qty' && current.meals[sheet.meal] && html`<${QuantitySheet} m=${current.meals[sheet.meal]} p=${sheet.p} byId=${byId} room=${room}
      onSet=${(g) => { edit(setQuantity(sheet.meal, sheet.p, g, byId)); close(); }} onClose=${close} />`}
    ${sheet?.kind === 'add' && html`<${AddIngredientSheet} meal=${sheet.meal} m=${current.meals[sheet.meal]} approved=${approved} byId=${byId} room=${room}
      onAdd=${(p, g) => { edit(addIngredient(sheet.meal, p, g, byId)); close(); }} onClose=${close} />`}
    ${sheet?.kind === 'sub' && html`<${SubstituteSheet} m=${current.meals[sheet.meal]} meal=${sheet.meal} p=${sheet.p} approved=${approved} byId=${byId}
      onPick=${(x) => { edit(substitute(sheet.meal, sheet.p, x.product.id, x.g, byId)); close(); }}
      onCompensate=${() => { edit(compensate(sheet.meal, byId)); close(); }}
      onAlternatives=${() => setSheet({ kind: 'alt', meal: sheet.meal, without: sheet.p })} onClose=${close} />`}
    ${sheet?.kind === 'alt' && html`<${AlternativesSheet} plan=${plan} day=${day} target=${{ meal: sheet.meal, without: sheet.without ?? null }} opts=${opts} byId=${byId} current=${current.meals[sheet.meal]}
      onPick=${(m) => { edit(setMeal(sheet.meal, m)); close(); }} onClose=${close} />`}
    ${sheet?.kind === 'out' && html`<${EatOutSheet} profile=${profile} updateProfile=${updateProfile} title=${sheet.extra ? 'Aggiungi un extra' : `${mealLabel(sheet.meal)} fuori casa`}
      onPick=${(preset) => { edit(sheet.extra ? addExtra(preset) : eatOut(sheet.meal, preset)); close(); }} onClose=${close} />`}
  </div>`;
}

/** One meal: name and macros, ingredients (tap name = remove, tap amount = change), two main actions and a menu. */
function MealCard({ meal, m, byId, approved, profile, edit, open, rebalance }) {
  const [showRecipe, setShowRecipe] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (!m) return html`<section class="card meal"><h3>${mealLabel(meal)}</h3><p class="muted small">Nessuna ricetta possibile con i tuoi prodotti per questo pasto.</p></section>`;
  if (m.skippedMeal) return html`<section class="card meal skipped">
    <div class="meal-top"><small class="muted">${mealLabel(meal)} · 0 kcal</small><span class="tag">saltato</span></div>
    <p class="small muted">${recipeById[m.replaced?.recipeId]?.name ?? m.replaced?.savedName ?? 'Pasto'}: calorie passate agli altri pasti. <button class="link" onClick=${() => edit(unskipMeal(meal))}>Ripristina</button></p>
  </section>`;
  if (m.external) return html`<section class="card meal done">
    <div class="meal-top"><small class="muted">${mealLabel(meal)} · ${r0(m.totals.kcal)} kcal · stima</small><span class="tag">fuori casa</span></div>
    <h3><${Icon} name="fork" size=${18} /> ${m.external.name}</h3>
    <${MacroDots} t=${m.totals} />
    <div class="actions"><button class="ghost small" onClick=${() => edit(undoEatOut(meal))}><${Icon} name="undo" size=${16} /> Torna al pasto del piano</button></div>
  </section>`;
  // A meal you created yourself has no recipe behind it.
  const r = recipeById[m.recipeId] ?? { name: 'Pasto personalizzato', method: null, minutes: 0, steps: [] };
  const skipped = m.skipped ?? [];
  const missing = skipped.filter((p) => productRole(byId[p]) !== 'other');
  const modified = skipped.length || (m.custom && !m.savedId) || m.boosted;
  // An eaten meal shrinks to one line: the day stays readable, and a tap opens it again.
  if (m.done && !expanded) return html`<button class="card meal done collapsed" aria-expanded="false" onClick=${() => setExpanded(true)}>
    <span class="meal-top"><small class="muted">${mealLabel(meal)} · <b>${r0(m.totals.kcal)} kcal</b></small><span class="tag ok">✓ mangiato</span></span>
    <span class="collapsed-name">${m.savedName ?? r.name}</span></button>`;
  return html`<section class=${'card meal' + (m.done ? ' done' : '')}>
    <div class="meal-top">
      <small class="muted">${mealLabel(meal)} · <b>${r0(m.totals.kcal)} kcal</b></small>
      ${m.done ? html`<button class="tag ok" aria-expanded="true" onClick=${() => setExpanded(false)}>✓ mangiato · chiudi</button>` : m.leftover ? html`<span class="tag">avanzo di ieri</span>` : modified ? html`<span class="tag">modificato</span>` : ''}
    </div>
    <h3>${m.savedName ?? r.name}${m.savedName ? html`<span class="tag">salvato</span>` : ''}</h3>
    <div class="meal-meta"><${MacroDots} t=${m.totals} /><small class="muted">${r.method ? METHOD[r.method] : 'Creato da te'}${r.minutes ? ` · ${r.minutes}′` : ''}${r.portable ? ' · da portare' : ''}${r.steps.length > 0 ? html` · <button class="link" aria-expanded=${showRecipe} onClick=${() => setShowRecipe(!showRecipe)}>${showRecipe ? 'chiudi ricetta' : 'ricetta'}</button>` : ''}</small></div>
    ${rebalance}
    <ul class="items">${m.items.map((it) => html`<li class=${skipped.includes(it.p) ? 'off' : ''}>
      <button class="iname" disabled=${m.done} onClick=${() => edit(it.replaces ? revertSubstitute(meal, it.p, byId) : it.added || it.addedG ? removeAdded(meal, it.p, byId) : toggleSkip(meal, it.p, byId))} aria-pressed=${skipped.includes(it.p)}>
        <span>${byId[it.p].name}${it.replaces ? html`<small class="muted">al posto di ${short(byId, it.replaces).toLowerCase()} · tocca per annullare</small>` : ''}${it.added ? html`<small class="muted">aggiunto · tocca per togliere</small>` : ''}${it.addedG ? html`<small class="muted">+${formatQty(it.p, it.addedG)} aggiunti · tocca per togliere</small>` : ''}</span></button>
      <button class="iqty" disabled=${m.done || skipped.includes(it.p)} onClick=${() => open('qty', { p: it.p })} aria-label=${`Cambia quantità di ${byId[it.p].name}`}>
        <b>${formatQty(it.p, it.g)}</b>
        ${it.boostedFrom != null && it.boostedFrom !== it.g ? html`<small class="muted">era ${formatQty(it.p, it.boostedFrom)}</small>` : ''}
        ${it.editedFrom != null ? html`<small class="muted">piano ${formatQty(it.p, it.editedFrom)}</small>` : ''}</button></li>`)}</ul>
    ${!m.done && missing.length > 0 && html`<p class="missing small">Senza ${missing.map((x) => short(byId, x).toLowerCase()).join(', ')}: ${r0(nutrientsFull(m, byId).kcal)} → ${r0(m.totals.kcal)} kcal.${' '}<button class="link" onClick=${() => open('sub', { p: missing[0] })}>Cosa faccio senza?</button></p>`}
    ${!m.done && m.boosted && html`<p class="small muted">Porzioni aumentate per compensare. <button class="link" onClick=${() => edit(undoCompensate(meal, byId))}>Annulla l'aumento</button></p>`}
    ${!m.done && !m.boosted && m.undoneBoost && html`<p class="small muted">Aumento annullato. <button class="link" onClick=${() => edit(redoCompensate(meal, byId))}>Ripristina</button></p>`}
    ${showRecipe && html`<ol class="steps">${r.steps.map((st) => html`<li>${stepText(st, m.items.filter((i) => !skipped.includes(i.p)), profile.microwaveW)}</li>`)}</ol>`}
    <div class="actions">
      ${m.done
        ? html`<button class="ghost small" onClick=${() => edit(setDone(meal, false))}><${Icon} name="undo" size=${16} /> Non l'ho mangiato</button>`
        : html`<button class="ghost small strong" onClick=${() => edit(setDone(meal, true))}><${Icon} name="check" size=${16} /> Segna come mangiato</button>
          <button class="ghost small" onClick=${() => open('alt')}><${Icon} name="swap" size=${16} /> Cambia</button>`}
      ${!m.done && html`<button class="ghost small icon-only" aria-label="Altre azioni" onClick=${() => open('menu')}><${Icon} name="more" size=${20} /></button>`}
    </div>
  </section>`;
}

function SaveMealSheet({ m, byId, onSave, onClose }) {
  const [name, setName] = useState(m.savedName ?? recipeById[m.recipeId]?.name ?? '');
  const snap = snapshotMeal(m);
  const t = nutrientsOf(snap.items, byId);
  return html`<${Sheet} title="Salva questo pasto" onClose=${onClose}>
    <form onSubmit=${(e) => { e.preventDefault(); name.trim() && onSave(name.trim()); }}>
      <label>Nome<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Es. La mia pasta al parmigiano" autofocus /></label>
      <p class="small muted">Verrà salvato così, con le quantità di adesso${(m.skipped ?? []).length ? ' (senza gli ingredienti barrati)' : ''}:</p>
      <ul class="plist">${snap.items.map((i) => html`<li class="wrow"><span>${byId[i.p].name}</span><b>${formatQty(i.p, i.g)}</b></li>`)}</ul>
      <p class="small">${r0(t.kcal)} kcal</p><${MacroDots} t=${t} />
      <button class="primary" disabled=${!name.trim() || !snap.items.length}>Salva</button>
    </form>
  <//>`;
}

/** Build a meal from scratch with products from the approved list. */
function MealBuilder({ meal, byId, approved, onCancel, onCreate }) {
  const [name, setName] = useState('');
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const t = nutrientsOf(items, byId);
  const add = (p) => { setItems([...items, { p, g: addDefault(p) }]); setQ(''); };
  const setG = (p, g) => setItems(items.map((i) => (i.p === p ? { ...i, g } : i)));
  const matches = q.trim().length < 1 ? [] : [...approved].map((id) => byId[id]).filter((p) => p && !items.some((i) => i.p === p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  const build = () => ({
    id: uid(), name: name.trim(), recipeId: null, createdAt: today(),
    items: items.filter((i) => i.g > 0).map((i) => ({ p: i.p, g: i.g, role: 'fixed', min: i.g, max: i.g })),
  });
  const ready = name.trim() && items.some((i) => i.g > 0);
  return html`
    <label>Nome<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Es. Toast della domenica" /></label>
    <p class="label-like">Ingredienti</p>
    ${items.length === 0 && html`<p class="small muted">Cerca qui sotto i prodotti della tua lista e toccali per aggiungerli.</p>`}
    <ul class="items">${items.map((i) => html`<li>
      <button class="iname" onClick=${() => setItems(items.filter((x) => x.p !== i.p))} aria-label=${`Togli ${byId[i.p].name}`}>
        <span>${byId[i.p].name}<small class="muted">tocca per togliere</small></span></button>
      <button class="iqty" onClick=${() => setEditing(editing === i.p ? null : i.p)} aria-expanded=${editing === i.p}><b>${formatQty(i.p, i.g)}</b></button></li>
      ${editing === i.p && html`<li class="editrow"><${QtyStepper} p=${i.p} g=${i.g} setG=${(g) => setG(i.p, g)} step=${Math.min(unitsFor(i.p).fine ?? unitsFor(i.p).step, unitsFor(i.p).step)} /></li>`}`)}</ul>
    <input class="search" type="search" placeholder="Aggiungi un prodotto della tua lista" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${matches.length > 0 && html`<ul class="results alt">${matches.map((p) => html`<li><button onClick=${() => add(p.id)}><span><b>${p.name}</b>
      <small class="muted">di solito ${formatQty(p.id, addDefault(p.id))} · ${r0(p.nutrients.energyKcal)} kcal/100 g</small></span></button></li>`)}</ul>`}
    ${items.length > 0 && html`<p class="small"><b>${r0(t.kcal)} kcal</b></p><${MacroDots} t=${t} /><${MacroLegend} />`}
    <button class="primary" disabled=${!ready} onClick=${() => onCreate(build(), true)}>Salva e metti a ${mealLabel(meal).toLowerCase()}</button>
    <button class="ghost" disabled=${!ready} onClick=${() => onCreate(build(), false)}>Salva soltanto</button>
    <button class="ghost" onClick=${onCancel}>Indietro</button>`;
}

function SavedMealsSheet({ meal, saved, byId, approved, updateProfile, onPick, onCreate, onClose }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const rename = (id) => { updateProfile((p) => { p.savedMeals = p.savedMeals.map((x) => (x.id === id ? { ...x, name: draft.trim() || x.name } : x)); }); setEditing(null); };
  const remove = (x) => confirm(`Eliminare "${x.name}" dai pasti salvati?`) && updateProfile((p) => { p.savedMeals = p.savedMeals.filter((y) => y.id !== x.id); });
  if (creating) return html`<${Sheet} title="Crea un pasto" onClose=${onClose}>
    <${MealBuilder} meal=${meal} byId=${byId} approved=${approved} onCancel=${() => setCreating(false)} onCreate=${onCreate} />
  <//>`;
  return html`<${Sheet} title="Pasti salvati" onClose=${onClose}>
    <button class="primary" onClick=${() => setCreating(true)}><${Icon} name="plus" size=${18} /> Crea un nuovo pasto</button>
    ${saved.length === 0 && html`<p class="muted small">Puoi anche salvare un pasto del piano dopo averlo modificato: menu ⋯ → "Salva questo pasto".</p>`}
    ${saved.length > 0 && html`<p class="small muted">Tocca un pasto per metterlo a ${mealLabel(meal).toLowerCase()}. Il resto della giornata si ricalcola.</p><${MacroLegend} />`}
    <ul class="results alt">${saved.map((x) => {
      const t = nutrientsOf(x.items.filter((i) => byId[i.p]), byId);
      const missing = x.items.filter((i) => !approved.has(i.p));
      return html`<li>
        ${editing === x.id
          ? html`<form class="rename" onSubmit=${(e) => { e.preventDefault(); rename(x.id); }}>
              <input value=${draft} onInput=${(e) => setDraft(e.target.value)} aria-label="Nuovo nome" autofocus />
              <button class="ghost small strong">Salva</button></form>`
          : html`<button onClick=${() => onPick(x)}><span><b>${x.name}</b><${MacroDots} t=${t} />
              <small class="muted">${r0(t.kcal)} kcal · ${x.items.map((i) => byId[i.p] ? short(byId, i.p) : '?').join(', ')}</small>
              ${missing.length > 0 && html`<small class="warn-text">Contiene prodotti che non sono più nella tua lista</small>`}</span></button>
            <button class="x" aria-label=${`Rinomina ${x.name}`} onClick=${() => { setEditing(x.id); setDraft(x.name); }}><${Icon} name="pencil" size=${16} /></button>
            <button class="x danger" aria-label=${`Elimina ${x.name}`} onClick=${() => remove(x)}><${Icon} name="close" size=${16} /></button>`}
      </li>`;
    })}</ul>
  <//>`;
}

function MealMenu({ meal, m, onPick, onReset, onSkip, onRemove, onClose }) {
  const extraSlot = meal.includes('_');
  const modified = (m.skipped ?? []).length || m.custom || m.boosted;
  return html`<${Sheet} title=${mealLabel(meal)} onClose=${onClose}>
    <ul class="results alt menu">
      <li><button onClick=${() => onPick('add')}><${Icon} name="plus" /><span><b>Aggiungi un ingrediente</b><small class="muted">Un prodotto della tua lista, nella quantità che vuoi</small></span></button></li>
      <li><button onClick=${() => onPick('out')}><${Icon} name="fork" /><span><b>Mangiato fuori casa</b><small class="muted">Lasagna della mamma, sushi, pizza… con una stima delle calorie</small></span></button></li>
      <li><button onClick=${() => onPick('saved')}><${Icon} name="bookmark" /><span><b>Pasti salvati e nuovi</b><small class="muted">Metti un pasto che hai salvato, o creane uno da zero</small></span></button></li>
      <li><button onClick=${() => onPick('save')}><${Icon} name="bookmarkPlus" /><span><b>Salva questo pasto</b><small class="muted">Con le tue modifiche e un nome, per riusarlo quando vuoi</small></span></button></li>
      ${extraSlot
        ? html`<li><button onClick=${onRemove}><${Icon} name="close" /><span><b>Togli questo spuntino</b><small class="muted">Era un'aggiunta tua: sparisce dalla giornata</small></span></button></li>`
        : html`<li><button onClick=${onSkip}><${Icon} name="skip" /><span><b>Salta questo pasto</b><small class="muted">Non lo mangi: le sue calorie passano agli altri pasti di oggi</small></span></button></li>`}
      ${modified && html`<li><button onClick=${() => confirm('Tornare al pasto come nel piano?') && onReset()}><${Icon} name="undo" /><span><b>Annulla tutte le modifiche</b><small class="muted">Ingredienti tolti, aggiunti, sostituiti e quantità tornano come nel piano</small></span></button></li>`}
    </ul>
  <//>`;
}

const IGNORE_AS_MISSING = new Set(['sale', 'pepe_nero', 'paprika', 'prezzemolo', 'basilico', 'limone', 'olio_evo']);
const short = (byId, p) => byId[p].name.split(' – ')[0];
const nutrientsFull = (m, byId) => nutrientsOf(m.items, byId);

function AlternativesSheet({ plan, day, target, opts, byId, current, onPick, onClose }) {
  // Like holding cards: each ingredient can be kept (the new dish must have it) or removed (must not).
  const [hold, setHold] = useState(() => Object.fromEntries([...(current?.skipped ?? []), target.without].filter(Boolean).map((p) => [p, 'remove'])));
  const keep = Object.keys(hold).filter((p) => hold[p] === 'keep');
  const remove = Object.keys(hold).filter((p) => hold[p] === 'remove');
  const cycle = (p) => setHold((h) => ({ ...h, [p]: h[p] === 'keep' ? 'remove' : h[p] === 'remove' ? undefined : 'keep' }));
  const all = alternatives(plan, day, target.meal, opts, byId, { keep, remove }).filter((a) => a.recipe.id !== current?.recipeId);
  const full = all.filter((a) => a.kept === keep.length);
  const list = full.length ? full : all.slice(0, 8);
  const chips = (current?.items ?? []).map((i) => i.p).filter((p) => !IGNORE_AS_MISSING.has(p));

  return html`<${Sheet} title=${`Alternative per ${mealLabel(target.meal).toLowerCase()}`} onClose=${onClose}>
    ${chips.length > 0 && html`
      <p class="small muted">Tocca gli ingredienti del piatto attuale: <b>1 volta 🔒 tienilo</b>, <b>2 volte ✕ toglilo</b>, 3 volte indifferente.</p>
      <div class="chips">${chips.map((p) => html`<button class=${hold[p] ?? ''} onClick=${() => cycle(p)}>
        ${hold[p] === 'keep' ? '🔒 ' : hold[p] === 'remove' ? '✕ ' : ''}${short(byId, p)}</button>`)}</div>`}
    ${(keep.length > 0 || remove.length > 0) && html`<p class="small">${keep.length ? `Con ${keep.map((p) => short(byId, p).toLowerCase()).join(', ')}` : ''}${keep.length && remove.length ? ' · ' : ''}${remove.length ? `senza ${remove.map((p) => short(byId, p).toLowerCase()).join(', ')}` : ''}</p>`}
    ${all.length === 0 && html`<p class="muted">Nessun piatto possibile con questi vincoli: prova a togliere un 🔒.</p>`}
    ${keep.length > 0 && !full.length && all.length > 0 && html`<p class="warn small">Nessun piatto ha tutti gli ingredienti che vuoi tenere: ecco quelli che ne hanno di più.</p>`}
    ${list.length > 0 && html`<${MacroLegend} />`}
    ${list.length > 0 && html`<button class="ghost" onClick=${() => onPick(list[Math.floor(Math.random() * list.length)].meal)}><${Icon} name="dice" size=${18} /> Scegli tu a caso</button>`}
    <ul class="results alt">${list.map(({ recipe, meal, fitsBudget, kept }) => html`<li><button onClick=${() => onPick(meal)}>
      <span><b>${recipe.name}</b><${MacroDots} t=${meal.totals} /><small class="muted">${r0(meal.totals.kcal)} kcal · ${METHOD[recipe.method]}${recipe.minutes ? ` · ${recipe.minutes} min` : ''}${fitsBudget ? '' : ' · porzione abbondante'}${keep.length && kept < keep.length ? ` · tiene ${kept} di ${keep.length}` : ''}</small>
      <small class="muted">${meal.items.filter((i) => !IGNORE_AS_MISSING.has(i.p)).map((i) => short(byId, i.p)).join(', ')}</small></span></button></li>`)}</ul>
  <//>`;
}

const MACRO_NAME = { protein: 'proteine', carbs: 'carboidrati', fat: 'grassi', fiber: 'fibre' };
// Colour code for macros: carbs blue, protein red, fat yellow, fibre green (also shown as a legend).
const MACRO_GLYPH = [['carbs', 'C', 'Carboidrati'], ['protein', 'P', 'Proteine'], ['fat', 'G', 'Grassi'], ['fiber', 'F', 'Fibre']];

function MacroLegend() {
  return html`<p class="legend">${MACRO_GLYPH.map(([k, , label]) => html`<span><i class=${'mc ' + k}></i>${label}</span>`)}</p>`;
}

/** Grams of each macro with its colour glyph; with `delta`, signed differences. */
function MacroDots({ t, delta = false }) {
  const fmt = (v) => (delta ? (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(r0(v)) : r0(v));
  return html`<span class="macros">${MACRO_GLYPH.map(([k, letter, label]) => html`<span title=${label}><i class=${'mc ' + k}>${letter}</i>${fmt(t[k] ?? 0)} g</span>`)}</span>`;
}

/** Optional suggestion on the next meal after a meal that lost protein, carbs, fat or fibre. */
/** "Add 150 g of fennel to dinner (+3 g fibre)" with the person's own vegetables, or psyllium. */
function FiberTip({ day, approved, byId, edit }) {
  const tip = fiberSuggestion(day, approved, byId);
  const name = tip && short(byId, tip.product.id).toLowerCase();
  return html`<span>
    ${tip
      ? html` Puoi ${tip.already ? 'aumentare' : 'aggiungere'} ${formatQty(tip.product.id, tip.g)} di ${name} ${tip.already ? 'nel' : 'al'} pasto «${mealLabel(tip.meal).toLowerCase()}» (+${dec(tip.gain)} g di fibre)
          <button class="ghost small strong inline-btn" onClick=${() => edit(addIngredient(tip.meal, tip.product.id, tip.g, byId))}><${Icon} name="plus" size=${14} /> Aggiungi</button>${' '}oppure prendere`
      : ' Puoi prendere'} 5 g di psillio sciolti in un bicchiere grande d'acqua.</span>`;
}

function RebalanceCard({ s, m, meal, plan, day, opts, byId, edit, onDismiss }) {
  const dayObj = plan.days[day];
  const [openCard, setOpenCard] = useState(false);
  const from = s.from.map((x) => mealLabel(x).replace(' ✈️', '').toLowerCase()).join(' e ');
  const summary = s.missing.map((k) => `${r0(s.deficit[k])} g di ${MACRO_NAME[k]}`).join(', ');
  const mp = openCard && s.missing.includes('protein') ? moreProtein(m, s.gap.protein, byId) : null;
  const alts = openCard ? s.missing.map((k) => [k, richerAlternative(plan, day, meal, opts, byId, k)]).filter(([, a]) => a) : [];
  const seen = new Set();
  return html`<div class="rebalance">
    <div class="rb-head">
      <button class="link" aria-expanded=${openCard} onClick=${() => setOpenCard(!openCard)}><${Icon} name="balance" size=${16} /> Da ${from} mancano ${summary} · ${openCard ? 'chiudi' : 'vedi proposte'}</button>
      <button class="x" aria-label="Ignora il suggerimento" onClick=${onDismiss}><${Icon} name="close" size=${16} /></button>
    </div>
    ${openCard && html`
      ${s.missing.map((k) => html`<p class="small">${k === 'protein' || k === 'fiber'
        ? `Nel resto della giornata ne mancano ancora circa ${r0(s.gap[k])} g.`
        : `${MACRO_NAME[k][0].toUpperCase() + MACRO_NAME[k].slice(1)}: le calorie sono già passate agli altri pasti, recuperarli non serve per dimagrire.`}</p>`)}
      <div class="actions">
        ${mp && html`<button class="ghost small strong" onClick=${() => edit(setMeal(meal, { ...mp, custom: true, rebalanced: true }))}>💪 Stesso piatto, più proteine (+${r0(mp.gain)} g)</button>`}
        ${alts.filter(([, a]) => !seen.has(a.recipe.id) && seen.add(a.recipe.id)).map(([k, a]) => html`<button class="ghost small" onClick=${() => edit(setMeal(meal, a.meal))}>
          🔄 ${a.recipe.name} (${r0(a.meal.totals[k])} g ${MACRO_NAME[k]})</button>`)}
      </div>
      ${!mp && !alts.length && html`<p class="small muted">Con i tuoi prodotti questo pasto non può dare di più senza superare le calorie.</p>`}
      ${s.missing.includes('protein') && s.gap.protein >= 15 && html`<p class="small muted"><${Icon} name="pill" size=${15} /> Facoltativo: una dose di proteine whey (circa 25 g di polvere) dà circa 20 g di proteine.</p>`}
      ${s.missing.includes('fiber') && html`<div class="small muted"><${FiberTip} day=${dayObj} approved=${opts.approved} byId=${byId} edit=${edit} /></div>`}`}
  </div>`;
}

/** − / + selector: in pieces for countable products (4 würstel), in grams for the rest (pasta). */
function QtyStepper({ p, g, setG, step }) {
  const piece = pieceUnit(p);
  if (piece) {
    const n = Math.round((g / piece.w) * 2) / 2;
    const setN = (x) => setG(Math.max(0.5, x) * piece.w);
    return html`<div class="stepper">
      <button class="ghost" onClick=${() => setN(n - 1 >= 1 ? n - 1 : 0.5)} aria-label="Uno in meno">−</button>
      <input type="number" inputmode="decimal" step="0.5" value=${n} onInput=${(e) => setN(num(e.target.value) || 0.5)} />
      <span>${n === 1 || n === 0.5 ? piece.one : piece.many}</span>
      <button class="ghost" onClick=${() => setN(n < 1 ? 1 : n + 1)} aria-label="Uno in più">+</button>
    </div>`;
  }
  return html`<div class="stepper">
    <button class="ghost" onClick=${() => setG(Math.max(step, g - step))} aria-label="Meno">−</button>
    <input type="number" inputmode="decimal" value=${g} onInput=${(e) => setG(Math.max(0, num(e.target.value) || 0))} />
    <span>${unitsFor(p).ml ? 'ml' : 'g'}</span>
    <button class="ghost" onClick=${() => setG(g + step)} aria-label="Più">+</button>
  </div>`;
}

function QuantitySheet({ m, p, byId, room, onSet, onClose }) {
  const item = m.items.find((i) => i.p === p);
  const [g, setG] = useState(item.g);
  const u = unitsFor(p);
  const step = u.fine ?? u.step;
  const planned = item.editedFrom ?? item.g;
  const n = byId[p].nutrients;
  const per = (k, grams) => ((n[k] ?? 0) * grams) / 100;
  const delta = { kcal: per('energyKcal', g) - per('energyKcal', item.g), protein: per('protein', g) - per('protein', item.g), carbs: per('carbs', g) - per('carbs', item.g), fat: per('fat', g) - per('fat', item.g), fiber: per('fiber', g) - per('fiber', item.g) };
  return html`<${Sheet} title=${byId[p].name} onClose=${onClose}>
    <p class="small muted">Quanto ne mangi in questo pasto? Il resto della giornata si riadatta.</p>
    <${QtyStepper} p=${p} g=${g} setG=${setG} step=${step} />
    <p class="small"><b>${formatQty(p, g)}</b> · ${r0(per('energyKcal', g))} kcal ${g !== item.g ? html`<span class="muted">(${delta.kcal > 0 ? '+' : ''}${r0(delta.kcal)} kcal rispetto a ora)</span>` : ''}</p>
    ${g !== item.g && html`<${MacroDots} t=${delta} delta=${true} />`}
    <${MacroLegend} />
    ${delta.kcal > 0 && delta.kcal > room && html`<p class="warn small">Oggi ti restano circa ${r0(Math.max(0, room))} kcal: con questa quantità superi l'obiettivo di circa ${r0(delta.kcal - room)} kcal (gli altri pasti non ancora mangiati scenderanno per compensare, se possono).</p>`}
    <button class="primary" disabled=${!(g > 0) || g === item.g} onClick=${() => onSet(g)}>Conferma ${formatQty(p, g)}</button>
    ${planned !== item.g && html`<button class="ghost" onClick=${() => onSet(planned)}><${Icon} name="undo" size=${16} /> Torna alla quantità del piano (${formatQty(p, planned)})</button>`}
  <//>`;
}

function AddIngredientSheet({ meal, m, approved, byId, room, onAdd, onClose }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [g, setG] = useState(0);
  const choose = (id) => { setPick(id); setG(addDefault(id)); };
  const step = pick ? Math.min(unitsFor(pick).fine ?? unitsFor(pick).step, unitsFor(pick).step) : 1;
  const products = [...approved].map((id) => byId[id]).filter(Boolean)
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = pick && byId[pick].nutrients;
  const t = pick && { kcal: (n.energyKcal * g) / 100, protein: (n.protein * g) / 100, carbs: (n.carbs * g) / 100, fat: (n.fat * g) / 100, fiber: ((n.fiber ?? 0) * g) / 100 };
  return html`<${Sheet} title=${`Aggiungi a ${mealLabel(meal).toLowerCase()}`} onClose=${onClose}>
    <p class="small muted">Solo prodotti della tua lista. ${room > 0 ? `Oggi hai ancora circa ${r0(room)} kcal disponibili.` : `Oggi sei già all'obiettivo: ogni aggiunta va oltre.`}</p>
    ${pick ? html`
      <p><b>${byId[pick].name}</b>${m.items.some((i) => i.p === pick) ? html`<small class="muted">È già nel piatto: verranno aggiunti questi grammi.</small>` : ''}</p>
      <${QtyStepper} p=${pick} g=${g} setG=${setG} step=${step} />
      <p class="small">${formatQty(pick, g)} · <b>${r0(t.kcal)} kcal</b></p>
      <${MacroDots} t=${t} />
      <${MacroLegend} />
      <button class="primary" disabled=${!(g > 0)} onClick=${() => onAdd(pick, g)}>Aggiungi al piatto</button>
      <button class="ghost" onClick=${() => setPick(null)}>Scegli un altro prodotto</button>`
    : html`
      <input class="search" type="search" placeholder="Cerca tra i tuoi prodotti" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <ul class="results alt">${products.map((p) => html`<li><button onClick=${() => choose(p.id)}><span><b>${p.name}</b>
        <small class="muted">${r0(p.nutrients.energyKcal)} kcal per 100 g · di solito ${formatQty(p.id, addDefault(p.id))}</small></span></button></li>`)}</ul>`}
  <//>`;
}

function SubstituteSheet({ m, meal, p, approved, byId, onPick, onCompensate, onAlternatives, onClose }) {
  const { role, list } = substitutes(m, p, approved, byId, meal);
  const comp = compensation(m, byId);
  const how = { protein: 'con le stesse proteine', carb: 'con le stesse calorie', fat: 'con le stesse calorie', veg: 'con lo stesso peso' }[role];
  const sign = (n) => (n > 0 ? '+' : '') + r0(n);
  return html`<${Sheet} title=${`Senza ${short(byId, p).toLowerCase()}`} onClose=${onClose}>
    <${MacroLegend} />
    <p class="small muted">Piatto intero: ${r0((comp?.before ?? nutrientsFull(m, byId)).kcal)} kcal <${MacroDots} t=${comp?.before ?? nutrientsFull(m, byId)} />
      Senza ${short(byId, p).toLowerCase()}: ${r0(m.totals.kcal)} kcal <${MacroDots} t=${m.totals} /></p>
    <p class="small muted">Se lasci così, le calorie che mancano passano agli altri pasti di oggi non ancora mangiati. Oppure:</p>
    <h3>Mettici qualcos'altro</h3>
    <p class="small muted">Prodotti della tua lista che fanno la stessa funzione, nella quantità ${how}. L'abbinamento lo giudichi tu.</p>
    ${list.length === 0 && html`<p class="muted small">Nella tua lista non c'è niente di simile per questo pasto.</p>`}
    <ul class="results alt">${list.map((x) => html`<li><button onClick=${() => onPick(x)}>
      <span><b>${x.product.name}</b><small class="muted">${formatQty(x.product.id, x.g)} · ${sign(x.delta.kcal)} kcal rispetto all'originale</small><${MacroDots} t=${x.delta} delta=${true} /></span></button></li>`)}</ul>
    ${comp && html`<h3>Oppure aumenta quello che resta</h3>
      <p class="small muted">Le porzioni rimaste crescono finché il piatto torna circa alle calorie del piatto intero; gli altri pasti di oggi si riducono di conseguenza.</p>
      <ul class="results alt"><li><button onClick=${onCompensate}><span>
        <b>${comp.items.filter((i) => i.boostedFrom != null && i.boostedFrom !== i.g).map((i) => `${short(byId, i.p)} ${formatQty(i.p, i.boostedFrom)} → ${formatQty(i.p, i.g)}`).join(', ') || 'Porzioni invariate'}</b>
        <small class="muted">${r0(comp.after.kcal)} kcal</small><${MacroDots} t=${comp.after} />
        ${comp.capped && html`<small class="muted">Non arriva alle calorie del piatto intero: oltre questa porzione non conviene. Le calorie che mancano restano deficit in più, va bene.</small>`}
        ${comp.before.protein - comp.after.protein >= 10 && html`<small class="warn-text">Proteine ${r0(comp.before.protein)} → ${r0(comp.after.protein)} g: sazia meno, meglio non farlo spesso.</small>`}
      </span></button></li></ul>`}
    <h3>Oppure cambia piatto</h3>
    <button class="ghost" onClick=${onAlternatives}><${Icon} name="swap" size=${18} /> Piatti senza ${short(byId, p).toLowerCase()}</button>
  <//>`;
}

function EatOutSheet({ profile, updateProfile, title, onPick, onClose }) {
  const [custom, setCustom] = useState({ name: '', kcal: '', protein: '' });
  const mine = profile.customPresets ?? [];
  const saveCustom = () => {
    const preset = { id: 'c_' + uid(), name: custom.name.trim(), kcal: num(custom.kcal), protein: num(custom.protein) || 0, custom: true };
    updateProfile((p) => { p.customPresets = [...(p.customPresets ?? []), preset]; });
    onPick(preset);
  };
  const row = (p) => html`<li><button onClick=${() => onPick(p)}><span><b>${p.name}</b><small class="muted">${r0(p.kcal)} kcal${p.protein ? ` · ${r0(p.protein)} g prot.` : ''}${p.note ? ` · ${p.note}` : ''}</small></span></button>
    ${p.custom && html`<button class="x danger" aria-label="Elimina" onClick=${() => updateProfile((x) => { x.customPresets = x.customPresets.filter((c) => c.id !== p.id); })}><${Icon} name="close" size=${16} /></button>`}</li>`;
  return html`<${Sheet} title=${title} onClose=${onClose}>
    <p class="small muted">Sono stime medie: le porzioni reali variano. Le altre portate della giornata si ricalcolano di conseguenza.</p>
    ${mine.length > 0 && html`<h3>I tuoi</h3><ul class="results alt">${mine.map(row)}</ul>`}
    <h3>Più comuni</h3><ul class="results alt">${PRESETS.map(row)}</ul>
    <h3>Nuovo</h3>
    <label>Cosa hai mangiato<input value=${custom.name} placeholder="es. Parmigiana di zia" onInput=${(e) => setCustom({ ...custom, name: e.target.value })} /></label>
    <div class="row"><label>Calorie (kcal)<input inputmode="numeric" value=${custom.kcal} onInput=${(e) => setCustom({ ...custom, kcal: e.target.value })} /></label>
      <label>Proteine (g, se le sai)<input inputmode="numeric" value=${custom.protein} onInput=${(e) => setCustom({ ...custom, protein: e.target.value })} /></label></div>
    <button class="primary" disabled=${!custom.name.trim() || !(num(custom.kcal) > 0)} onClick=${saveCustom}>Aggiungi e salva per la prossima volta</button>
    <p class="small muted">Non sai le calorie? Chiedimele in chat e le aggiungo tra quelle comuni.</p>
  <//>`;
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
    <div class="search-row">
      <input class="search" type="search" placeholder="Cerca un prodotto" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <button class="ghost icon-only add-btn" aria-label="Aggiungi un prodotto" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${22} /></button>
    </div>
    ${filter === 'all' && html`<p class="muted small">Spunta ✓ gli alimenti che vuoi nel tuo piano. Gli altri restano in dispensa per chi vive con te.</p>`}
    ${Object.entries(CATEGORIES).map(([cat, label]) => {
      const list = visible.filter((p) => p.category === cat).sort((a, b) => (qualityScore(b).score ?? -1) - (qualityScore(a).score ?? -1));
      // Categories start closed (one line each); a search opens them all.
      return list.length > 0 && html`<details class="card tight group" open=${!!q} key=${cat + (q ? ':q' : '')}><summary><h3>${label}</h3><span class="count">${list.length}</span></summary>
        <ul class="plist">${list.map((p) => html`<li>
          <button class="prow" onClick=${() => setDetail(p)}><${ScoreBadge} product=${p} />
            <span class="pname">${p.name}<small class="muted">${r0(p.nutrients.energyKcal)} kcal · ${dec(p.nutrients.protein)} g prot. /100 g${p.flags.length ? ' · ⚠️' : ''}</small></span></button>
          <button class=${'tick' + (approved.has(p.id) ? ' on' : '')} aria-label=${`${p.name}: ${approved.has(p.id) ? 'nella mia lista' : 'non nella mia lista'}`} aria-pressed=${approved.has(p.id)} onClick=${() => toggle(p.id)}><${Icon} name="check" size=${18} /></button>
        </li>`)}</ul></details>`;
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

/**
 * Modal sheet: grabber and swipe down to dismiss on touch, Esc on desktop, close button on the
 * leading edge (iOS places Cancel/Close there), focus moved into the sheet while it is open.
 */
function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [dy, setDy] = useState(0);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  const start = (e) => { if (e.pointerType !== 'mouse') drag.current = e.clientY; };
  const move = (e) => { if (drag.current != null) setDy(Math.max(0, e.clientY - drag.current)); };
  const end = () => { if (drag.current == null) return; drag.current = null; if (dy > 90) onClose(); else setDy(0); };
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title} tabIndex="-1" ref=${ref}
      style=${dy ? `transform: translateY(${dy}px); transition: none` : ''}>
      <div class="sheet-grab" onPointerDown=${start} onPointerMove=${move} onPointerUp=${end} onPointerCancel=${end}>
        <span class="grabber" aria-hidden="true"></span>
        <div class="sheet-head">
          <button class="close-btn" aria-label="Chiudi" onClick=${onClose}><${Icon} name="close" size=${16} /></button>
          <h2>${title}</h2>
        </div>
      </div>
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
  const toggle = (id) => updateProfile((p) => { p.shoppingChecked = { ...p.shoppingChecked, [id]: !checked[id] }; });
  const toBuy = list.filter((i) => !i.pantry && !checked[i.id]);
  const done = list.filter((i) => !i.pantry && checked[i.id]);
  const pantry = list.filter((i) => i.pantry);
  const copy = () => navigator.clipboard?.writeText(toBuy.map((i) => `• ${i.name}: ${i.qty}`).join('\n'));
  const row = (i) => html`<li class=${checked[i.id] ? 'done' : ''}><label><input type="checkbox" checked=${!!checked[i.id]} onChange=${() => toggle(i.id)} />
    <span class="shop-name">${i.name}<small class="muted"><b>${i.main}</b>${i.detail ? ` · ${i.detail}` : ''}</small></span></label></li>`;
  return html`
    <div class="shop-head">
      <p class="small muted">Per i 7 giorni del piano · <b>${done.length} di ${done.length + toBuy.length}</b> presi</p>
      <button class="ghost small" onClick=${copy}>Copia lista</button>
    </div>
    ${Object.entries(CATEGORIES).map(([cat, label]) => {
      const items = toBuy.filter((i) => i.category === cat);
      return items.length > 0 && html`<section class="card tight"><h3>${label}</h3><ul class="shop">${items.map(row)}</ul></section>`;
    })}
    ${toBuy.length === 0 && html`<section class="card"><p>Hai preso tutto 🎉</p></section>`}
    ${done.length > 0 && html`<details class="card tight group"><summary><h3>Già presi</h3><span class="count">${done.length}</span></summary><ul class="shop">${done.map(row)}</ul></details>`}
    ${pantry.length > 0 && html`<details class="card tight group"><summary><h3>Da avere in casa</h3><span class="count">${pantry.length}</span></summary>
      <p class="small muted">Ne serve pochissimo: controlla solo di averli.</p><ul class="shop">${pantry.map(row)}</ul></details>`}`;
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
  return html`<label class="ghost filebtn"><${Icon} name="camera" size=${18} /> Importa referto Fitdays<input type="file" accept="image/*" onChange=${read} /></label>
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
      <details class="mini-note"><summary><${Icon} name="lightbulb" size=${15} /> Come pesarti</summary>
        <p class="muted small">Pesati alla stessa ora, al mattino a digiuno. Se registri due volte lo stesso giorno, vale l'ultima. Al rientro da un volo è normale vedere 0,5-1 kg in più per i liquidi trattenuti: conta l'andamento, non il singolo giorno.</p></details>
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
    <details class="card tight group"><summary><h3>Storico</h3><span class="count">${weights.length}</span></summary><ul class="plist">${[...weights].reverse().map((w) => html`<li class="wrow">
      <span>${new Date(w.date + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
        ${BODY.some(([k]) => w[k] != null) && html`<small class="muted">${BODY.filter(([k]) => w[k] != null).map(([k, l, u]) => `${l} ${dec(w[k])}${u === 'livello' ? '' : ' ' + u}`).join(' · ')}</small>`}</span>
      <b>${dec(w.kg)} kg</b>
      <button class="x danger" aria-label="Elimina" onClick=${() => confirm('Eliminare questa pesata?') && updateProfile((p) => { p.weights = p.weights.filter((x) => x.date !== w.date); if (p.weights.length) p.weightKg = p.weights.at(-1).kg; })}><${Icon} name="close" size=${16} /></button></li>`)}</ul></details>`}`;
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

function ProfileTab({ state, profile, targets, update, updateProfile, setState, syncInfo }) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile.id]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const importFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    readBackup(file)
      .then((data) => confirm('Sostituire tutti i dati di questo dispositivo con il backup?') && update(() => data))
      .catch(() => alert('Questo file non è un backup dell\'app Dieta.'));
  };
  return html`
    <section class="card">
      <h2>Il tuo fabbisogno</h2>
      <div class="stats">
        <div><small class="muted">Metabolismo basale</small><b>${targets.bmr} kcal</b></div>
        <div><small class="muted">Consumo giornaliero</small><b>${targets.tdee} kcal</b></div>
        <div><small class="muted">Obiettivo</small><b>${targets.kcal} kcal</b></div>
        <div><small class="muted">IMC</small><b>${dec(targets.bmi)}</b></div>
      </div>
      <p class="small">Proteine <b>${targets.protein} g</b> · Carboidrati <b>${targets.carbs} g</b> · Grassi <b>${targets.fat} g</b> · Fibre <b>${targets.fiber} g</b></p>
      ${profile.medical && html`<p class="warn small">Hai indicato condizioni mediche: mostra questo piano al tuo medico prima di seguirlo.</p>`}
      <details class="mini-note"><summary><${Icon} name="lightbulb" size=${15} /> Come è calcolato</summary>
        ${targets.warnings.map((w) => html`<p class="small">${w}</p>`)}
        <p class="muted small">Calo atteso: circa ${targets.weeklyLoss.toFixed(2).replace('.', ',')} kg a settimana. Metabolismo calcolato con la formula ${targets.bmrMethod}; proteine a 1,6 g per kg di peso di riferimento per preservare i muscoli in deficit.</p>
        <${WeightSummary} profile=${profile} /></details>
    </section>
    <details class="card group"><summary><h3>Dati personali</h3><span class="count">${profile.name}</span></summary>
      <${ProfileFields} p=${draft} set=${setDraft} editWeight=${false} /></details>
    <details class="card group"><summary><h3>Abitudini e pasti a bordo</h3></summary>
      <${HabitFields} p=${draft} set=${setDraft} /></details>
    ${dirty && html`<div class="save-bar" role="region" aria-label="Modifiche non salvate">
      <button class="ghost" onClick=${() => setDraft(profile)}>Annulla</button>
      <button class="primary" onClick=${() => updateProfile((p) => Object.assign(p, draft))}>Salva</button>
    </div>`}
    <details class="card group"><summary><h3>Persone</h3><span class="count">${state.profiles.length}</span></summary>
      <ul class="plist">${state.profiles.map((p) => html`<li class="wrow"><span>${p.name}${p.id === state.activeId ? ' (attivo)' : ''}</span>
        ${p.id !== state.activeId && html`<button class="ghost small" onClick=${() => update((s) => { s.activeId = p.id; })}>Usa</button>`}</li>`)}</ul>
      <button class="ghost" onClick=${() => update((s) => { s.household.mode = 'coppia'; s.activeId = null; })}><${Icon} name="plus" size=${18} /> Aggiungi una persona</button>
      <p class="muted small">Ogni persona ha la sua lista di prodotti, il suo piano e il suo peso. La dispensa è in comune. Con la sincronizzazione attiva, ognuno usa il proprio telefono.</p>
    </details>
    <${SyncPanel} state=${state} setState=${setState} syncInfo=${syncInfo} />
    <details class="card group"><summary><h3>Backup</h3></summary>
      <p class="muted small">I dati restano solo su questo dispositivo. Esporta un backup ogni tanto, o per spostarli dal Mac all'iPhone.</p>
      <button class="ghost" onClick=${() => exportJson(state)}>Esporta backup</button>
      <label class="ghost filebtn">Importa backup<input type="file" accept="application/json" onChange=${importFile} /></label>
    </details>`;
}

render(html`<${App} />`, document.getElementById('app'));
