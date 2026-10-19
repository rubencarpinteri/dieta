// Phase 2: sync between devices with Firebase (Spark plan, free, no credit card).
// The app stays local-first: everything works offline, and changes are sent when the network is there.
//
// Firestore layout:
//   users/{uid}                      → { household }            which household this account belongs to
//   households/{hid}                 → { members[], mode, customProducts, updatedAt }
//   households/{hid}/profiles/{pid}  → { data: profile, updatedAt }
// Conflicts: the most recent change of each profile wins (profile.updatedAt).
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
let fb = null;

export const syncAvailable = () => Boolean(FIREBASE_CONFIG?.apiKey);

/** Load the Firebase SDK on first use (it is not needed by people who never turn sync on). */
export async function firebase() {
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(FIREBASE_CONFIG);
  // Long polling instead of the streaming connection: Safari on iPhone (above all the app added to the
  // Home Screen) can leave the stream open without ever delivering data.
  fb = { auth, store, au: auth.getAuth(a), db: store.initializeFirestore(a, { experimentalForceLongPolling: true }) };
  return fb;
}

const ERRORS = {
  'auth/invalid-email': 'Indirizzo email non valido.',
  'auth/missing-password': 'Inserisci la password.',
  'auth/weak-password': 'La password deve avere almeno 6 caratteri.',
  'auth/email-already-in-use': 'Esiste già un account con questa email: usa "Accedi".',
  'auth/invalid-credential': 'Email o password non corrette.',
  'auth/user-not-found': 'Email o password non corrette.',
  'auth/wrong-password': 'Email o password non corrette.',
  'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.',
  'auth/network-request-failed': 'Nessuna connessione: riprova quando sei online.',
  'permission-denied': 'Accesso negato: controlla il codice.',
};
export const syncError = (e) => ERRORS[e?.code] ?? 'Qualcosa non ha funzionato. Riprova quando sei online.';

export async function signIn(email, password, create) {
  const { auth, au } = await firebase();
  const fn = create ? auth.createUserWithEmailAndPassword : auth.signInWithEmailAndPassword;
  return (await fn(au, email.trim(), password)).user;
}

export async function signOut() {
  const { auth, au } = await firebase();
  await auth.signOut(au);
}

export async function onUser(cb) {
  const { auth, au } = await firebase();
  return auth.onAuthStateChanged(au, cb);
}

const sharedPart = (state) => ({ mode: state.household.mode, customProducts: state.customProducts });

/** The household this account belongs to, or null. */
export async function householdOf(uid) {
  const { store, db } = await firebase();
  const snap = await store.getDoc(store.doc(db, 'users', uid));
  return snap.exists() ? snap.data().household : null;
}

/** Create a household from this device's data. Its id is also the code to invite another person. */
export async function createHousehold(uid, state) {
  const { store, db } = await firebase();
  const ref = store.doc(store.collection(db, 'households'));
  await store.setDoc(ref, { members: [uid], ...sharedPart(state), updatedAt: Date.now() });
  await store.setDoc(store.doc(db, 'users', uid), { household: ref.id });
  await Promise.all(state.profiles.map((p) => pushProfile(ref.id, p)));
  return ref.id;
}

/** Join an existing household with its code. */
export async function joinHousehold(uid, hid) {
  const { store, db } = await firebase();
  await store.updateDoc(store.doc(db, 'households', hid), { members: store.arrayUnion(uid) });
  await store.setDoc(store.doc(db, 'users', uid), { household: hid });
}

export async function pushProfile(hid, profile) {
  const { store, db } = await firebase();
  await store.setDoc(store.doc(db, 'households', hid, 'profiles', profile.id), { data: profile, updatedAt: profile.updatedAt ?? Date.now() });
}

export async function pushShared(hid, state) {
  const { store, db } = await firebase();
  await store.updateDoc(store.doc(db, 'households', hid), { ...sharedPart(state), updatedAt: state.sharedUpdatedAt ?? Date.now() });
}

/** Listen to remote changes. Each account only receives its own profiles (the rules enforce it).
 *  Returns an unsubscribe function. */
export async function listen(hid, uid, { onProfiles, onShared, onError }) {
  const { store, db } = await firebase();
  const mine = store.query(store.collection(db, 'households', hid, 'profiles'), store.where('data.owner', '==', uid));
  const offA = store.onSnapshot(mine,
    (snap) => onProfiles(snap.docs.map((d) => d.data())), onError);
  const offB = store.onSnapshot(store.doc(db, 'households', hid),
    (snap) => snap.exists() && onShared(snap.data()), onError);
  return () => { offA(); offB(); };
}
