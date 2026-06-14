// ─── Hypothèses par défaut (éditables, à affiner avec des sources réelles)
// μ = rendement réel annuel moyen, σ = volatilité annuelle (écart-type)
// Source de référence indicative : données historiques long terme (Dimson, Marsh, Staunton)
const PROFILS = {
  prudent:    { mu: 0.03, sigma: 0.05, label: 'Prudent',   desc: 'Rendement ~3 %/an · Volatilité ~5 %/an — obligations, fonds euros' },
  equilibre:  { mu: 0.05, sigma: 0.10, label: 'Équilibré', desc: 'Rendement ~5 %/an · Volatilité ~10 %/an — mix actions / obligations' },
  dynamique:  { mu: 0.07, sigma: 0.15, label: 'Dynamique', desc: 'Rendement ~7 %/an · Volatilité ~15 %/an — majoritairement actions' },
};

const N_SIMULATIONS = 7000; // nombre de tirages Monte-Carlo

// Box-Muller : génère une valeur suivant une loi normale N(0,1)
function randn() {
  let u, v;
  do { u = Math.random(); v = Math.random(); } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Simule la trajectoire complète année par année par Monte-Carlo.
 * Retourne un tableau de { annee, p5, p50, p95 } de l'année 0 à horizonAnnees.
 *
 * @param {number} montantActuel     - Capital de départ (€)
 * @param {number} epargneMensuelle  - Versement mensuel régulier (€)
 * @param {number} horizonAnnees     - Durée en années entières
 * @param {string} profilRisque      - 'prudent' | 'equilibre' | 'dynamique'
 * @param {boolean} inflation        - true = euros constants (réel), false = nominal (+2% inflation)
 * @returns {Array<{annee:number, p5:number, p50:number, p95:number}>}
 */
function simulateTrajectory(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation = true) {
  const profil = PROFILS[profilRisque];
  if (!profil) throw new Error(`Profil inconnu : ${profilRisque}`);

  const INFLATION_HYPOTHESE = 0.02;
  const mu    = inflation ? profil.mu : profil.mu + INFLATION_HYPOTHESE;
  const sigma = profil.sigma;

  // Pour chaque simulation, on stocke le capital à chaque fin d'année
  const snapshots = Array.from({ length: horizonAnnees + 1 }, () => new Array(N_SIMULATIONS));

  for (let i = 0; i < N_SIMULATIONS; i++) {
    let capital = montantActuel;
    snapshots[0][i] = capital;

    for (let annee = 0; annee < horizonAnnees; annee++) {
      const rendementAnnuel = mu + sigma * randn();
      const tauxMensuel = Math.pow(1 + rendementAnnuel, 1 / 12) - 1;
      for (let m = 0; m < 12; m++) {
        capital = capital * (1 + tauxMensuel) + epargneMensuelle;
      }
      snapshots[annee + 1][i] = capital;
    }
  }

  // Pour chaque année, trier et extraire les percentiles
  return snapshots.map((vals, annee) => {
    vals.sort((a, b) => a - b);
    return {
      annee,
      p5:  vals[Math.floor(N_SIMULATIONS * 0.05)],
      p50: vals[Math.floor(N_SIMULATIONS * 0.50)],
      p95: vals[Math.floor(N_SIMULATIONS * 0.95)],
    };
  });
}

/**
 * Version finale uniquement (pour les tests unitaires).
 */
function simulateProjection(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation = true) {
  const traj = simulateTrajectory(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation);
  const last = traj[traj.length - 1];
  return { p5: last.p5, p50: last.p50, p95: last.p95 };
}

// Export pour les tests Node et pour l'UI
if (typeof module !== 'undefined') module.exports = { simulateProjection, simulateTrajectory, PROFILS };
