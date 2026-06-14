// ─── Hypothèses par défaut (éditables, à affiner avec des sources réelles)
// μ = rendement réel annuel moyen, σ = volatilité annuelle (écart-type)
// Source de référence indicative : données historiques long terme (Dimson, Marsh, Staunton)
const PROFILS = {
  prudent:    { mu: 0.03, sigma: 0.05 },  // ~3% réel / 5% vol  — ex: fonds euros + obligations
  equilibre:  { mu: 0.05, sigma: 0.10 },  // ~5% réel / 10% vol — ex: mix actions/obligations
  dynamique:  { mu: 0.07, sigma: 0.15 },  // ~7% réel / 15% vol — ex: majoritairement actions
};

const N_SIMULATIONS = 7000; // nombre de tirages Monte-Carlo

// Box-Muller : génère une valeur suivant une loi normale N(0,1)
function randn() {
  let u, v;
  do { u = Math.random(); v = Math.random(); } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Simule la trajectoire d'un objectif financier par Monte-Carlo.
 *
 * @param {number} montantActuel     - Capital de départ (€)
 * @param {number} epargneMensuelle  - Versement mensuel régulier (€)
 * @param {number} horizonAnnees     - Durée en années entières
 * @param {string} profilRisque      - 'prudent' | 'equilibre' | 'dynamique'
 * @param {boolean} inflation        - Si true, résultat en euros constants (rendement réel)
 *                                    Si false, résultat nominal (μ augmenté de ~2% inflation)
 * @returns {{ p5: number, p50: number, p95: number }}
 */
function simulateProjection(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation = true) {
  const profil = PROFILS[profilRisque];
  if (!profil) throw new Error(`Profil inconnu : ${profilRisque}`);

  // En mode nominal, on ajoute une hypothèse d'inflation de 2% au rendement réel
  const INFLATION_HYPOTHESE = 0.02;
  const mu    = inflation ? profil.mu : profil.mu + INFLATION_HYPOTHESE;
  const sigma = profil.sigma;

  const mois = horizonAnnees * 12;
  const resultats = new Array(N_SIMULATIONS);

  for (let i = 0; i < N_SIMULATIONS; i++) {
    let capital = montantActuel;

    // Simulation année par année, versements mensuels dans l'année
    for (let annee = 0; annee < horizonAnnees; annee++) {
      const rendementAnnuel = mu + sigma * randn();
      const tauxMensuel = Math.pow(1 + rendementAnnuel, 1 / 12) - 1;
      for (let m = 0; m < 12; m++) {
        capital = capital * (1 + tauxMensuel) + epargneMensuelle;
      }
    }

    resultats[i] = capital;
  }

  resultats.sort((a, b) => a - b);

  return {
    p5:  resultats[Math.floor(N_SIMULATIONS * 0.05)],
    p50: resultats[Math.floor(N_SIMULATIONS * 0.50)],
    p95: resultats[Math.floor(N_SIMULATIONS * 0.95)],
  };
}

// Export pour les tests Node et pour l'UI
if (typeof module !== 'undefined') module.exports = { simulateProjection, PROFILS };
