// Local-first storage. Everything lives in this browser (phase 1); export/import gives a backup.
const KEY = 'dieta:v1';

export const emptyState = () => ({ version: 1, household: { mode: 'singolo' }, customProducts: [], profiles: [], activeId: null });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState();
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private browsing): the app keeps working in memory.
  }
}

export function exportJson(state) {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `dieta-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toISOString().slice(0, 10);
