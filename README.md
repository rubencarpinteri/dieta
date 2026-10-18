# Dieta

Piano alimentare per dimagrire costruito **solo con i prodotti approvati da ciascuna persona**.
Web app installabile (PWA): funziona su iPhone e Mac, anche offline.

## Come funziona

- `data/products.json`: catalogo di casa. Generato da `tools/build_products.js` (Open Food Facts + valori medi CREA per i generici).
- `src/lib/scoring.js`: punteggio stile Yuka (60 nutrizione da Nutri-Score, 30 additivi, 10 bio; tetto a 49 con additivi ad alto rischio).
- `src/lib/targets.js`: fabbisogno (Mifflin-St Jeor), deficit, macro, soglie minime di sicurezza.
- `src/lib/recipes.js`: ricette (microonde, friggitrice ad aria, padella/pentola ≤ 15 min). Una ricetta è proposta solo se **tutti** gli ingredienti sono nella lista della persona.
- `src/lib/planner.js`: piano di 7 giorni, porzioni calcolate sugli obiettivi, giorni di volo con pasti da portare, limite di sale, suggerimento integratori.
- I dati personali restano nel browser (`localStorage`). Backup con Esporta/Importa nella scheda Profilo.

## Provarla sul Mac

```bash
python3 -m http.server 8790
```

Poi apri http://localhost:8790.

## Strumenti

```bash
node tools/build_products.js   # rigenera data/products.json da data/off_raw.json
node tools/report.js           # tabella punteggi
node tools/plan_demo.js        # piano di prova da terminale
```
