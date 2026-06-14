// ─── Hypothèses par défaut (éditables, à affiner avec des sources réelles)
// μ = rendement réel annuel moyen, σ = volatilité annuelle (écart-type)
//
// Sources de référence :
//   - Dimson, Marsh, Staunton « Triumph of the Optimists » (DMS) + Credit Suisse
//     Global Investment Returns Yearbook — série 1900-2023, ~20 pays
//   - Prudent  : proxy portefeuille obligataire diversifié (DMS bonds ~1-2% réel)
//                légèrement rehaussé pour tenir compte du fonds euros/obligations IG
//   - Équilibré : proxy 50/50 actions mondiales / obligations (DMS ~4-5% réel)
//   - Dynamique : proxy actions mondiales (DMS ~5% réel monde, ~7% US longue période)
//
// Ces chiffres sont des HYPOTHÈSES CONSERVATRICES à but pédagogique.
// L'utilisateur doit pouvoir les remettre en question selon son propre jugement.
const PROFILS = {
  prudent: {
    mu: 0.03, sigma: 0.05,
    label: 'Prudent',
    desc:  'Rendement moyen hypothétique : ~3 %/an réel · Volatilité : ~5 %/an',
    source: 'Proxy : portefeuille obligataire diversifié (fonds euros, obligations IG). Basé sur les données DMS 1900-2023.',
  },
  equilibre: {
    mu: 0.05, sigma: 0.10,
    label: 'Équilibré',
    desc:  'Rendement moyen hypothétique : ~5 %/an réel · Volatilité : ~10 %/an',
    source: 'Proxy : allocation 50 % actions mondiales / 50 % obligations. Données DMS longue période.',
  },
  dynamique: {
    mu: 0.07, sigma: 0.15,
    label: 'Dynamique',
    desc:  'Rendement moyen hypothétique : ~7 %/an réel · Volatilité : ~15 %/an',
    source: 'Proxy : portefeuille majoritairement actions mondiales (MSCI World). Données DMS + Shiller longue période.',
  },
};

const N_SIMULATIONS = 7000; // nombre de tirages Monte-Carlo

// Box-Muller : génère une valeur suivant une loi normale N(0,1)
function randn() {
  let u, v;
  do { u = Math.random(); v = Math.random(); } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const INFLATION_HYPOTHESE = 0.02; // +2 % appliqué au μ en mode nominal

/**
 * Simule la trajectoire complète année par année par Monte-Carlo.
 * Retourne un tableau de { annee, p5, p20, p50, p80, p95 } de l'année 0 à horizonAnnees.
 *
 * @param {number}  montantActuel      Capital de départ (€)
 * @param {number}  epargneMensuelle   Versement mensuel régulier (€)
 * @param {number}  horizonAnnees      Durée en années entières
 * @param {string}  profilRisque       'prudent' | 'equilibre' | 'dynamique'
 * @param {boolean} inflation          true = euros constants (déduction inflation ~2%)
 *                                     false = euros courants / nominaux (défaut)
 * @returns {Array<{annee, p5, p20, p50, p80, p95}>}
 */
function simulateTrajectory(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation = false) {
  const profil = PROFILS[profilRisque];
  if (!profil) throw new Error(`Profil inconnu : ${profilRisque}`);

  const mu    = inflation ? profil.mu : profil.mu + INFLATION_HYPOTHESE;
  const sigma = profil.sigma;

  // snapshots[annee][simulation] = capital à la fin de l'année
  const snapshots = Array.from({ length: horizonAnnees + 1 }, () => new Array(N_SIMULATIONS));

  for (let i = 0; i < N_SIMULATIONS; i++) {
    let capital = montantActuel;
    snapshots[0][i] = capital;
    for (let annee = 0; annee < horizonAnnees; annee++) {
      const r = mu + sigma * randn();
      const tauxMensuel = Math.pow(1 + r, 1 / 12) - 1;
      for (let m = 0; m < 12; m++) {
        capital = capital * (1 + tauxMensuel) + epargneMensuelle;
      }
      snapshots[annee + 1][i] = capital;
    }
  }

  return snapshots.map((vals, annee) => {
    vals.sort((a, b) => a - b);
    const p = q => vals[Math.min(Math.floor(N_SIMULATIONS * q), N_SIMULATIONS - 1)];
    return { annee, p5: p(0.05), p20: p(0.20), p50: p(0.50), p80: p(0.80), p95: p(0.95) };
  });
}

/**
 * Version finale uniquement (pour les tests et le calcul inverse).
 */
function simulateProjection(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation = false) {
  const traj = simulateTrajectory(montantActuel, epargneMensuelle, horizonAnnees, profilRisque, inflation);
  return traj[traj.length - 1];
}

/**
 * Mode inverse A — Combien épargner par mois ?
 * Trouve l'épargne mensuelle minimale pour que la médiane (P50) atteigne la cible.
 * Utilise une recherche binaire (30 itérations ≈ précision < 1 €).
 *
 * @returns {number} épargne mensuelle en €, ou Infinity si impossible même avec 100 000 €/mois
 */
function findEpargneMensuelle(montantActuel, cible, horizonAnnees, profilRisque, inflation = false) {
  // Cas trivial : le capital seul suffit déjà
  if (simulateProjection(montantActuel, 0, horizonAnnees, profilRisque, inflation).p50 >= cible) return 0;

  let lo = 0, hi = 100000;
  // Vérifier que hi est suffisant
  if (simulateProjection(montantActuel, hi, horizonAnnees, profilRisque, inflation).p50 < cible) return Infinity;

  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const res = simulateProjection(montantActuel, mid, horizonAnnees, profilRisque, inflation);
    if (res.p50 >= cible) hi = mid; else lo = mid;
  }
  return Math.ceil(hi);
}

/**
 * Mode inverse B — En combien de temps ?
 * Trouve le premier horizon (en années entières) où la médiane (P50) atteint la cible.
 * Retourne null si non atteint en 50 ans.
 *
 * Optimisation : une seule simulation sur 50 ans, lecture des percentiles par année.
 *
 * @returns {number|null} nombre d'années, ou null si non atteint en 50 ans
 */
function findHorizon(montantActuel, epargneMensuelle, cible, profilRisque, inflation = false) {
  const maxAns = 50;
  const traj = simulateTrajectory(montantActuel, epargneMensuelle, maxAns, profilRisque, inflation);
  const hit = traj.find(t => t.p50 >= cible);
  return hit ? hit.annee : null;
}

// Export pour les tests Node et pour l'UI
if (typeof module !== 'undefined') {
  module.exports = { simulateProjection, simulateTrajectory, findEpargneMensuelle, findHorizon, PROFILS };
}
