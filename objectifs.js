// ═══ MOTEUR DE PROJECTION MONTE-CARLO ═══════════════════════════════════════
//
// HYPOTHÈSES D'ANCRAGE (éditables — valeurs par défaut conservatrices)
// Le risque est représenté par une note continue 0-100.
// μ et σ sont interpolés linéairement entre deux points d'ancrage :
//
//   note 0   → μ_MIN / σ_MIN  : proxy "cash / fonds euros"
//              Source : rendement réel fonds euros 2010-2023 ≈ 0-1 %, majoré à 2 %
//              pour tenir compte d'un mix livrets + fonds euros classique.
//
//   note 100 → μ_MAX / σ_MAX  : proxy "100 % actions mondiales"
//              Source : Dimson, Marsh, Staunton (DMS) Global Investment Returns
//              Yearbook 1900-2023 — rendement réel actions mondiales ~5 %/an,
//              rehaussé à 8 % en nominal (+ inflation hypothétique 2 % + prime US).
//              Volatilité actions mondiales historique ~15-20 % ; retenu 18 %.
//
// Pour un score s (0-100) :
//   μ(s) = μ_MIN + (s / 100) * (μ_MAX - μ_MIN)
//   σ(s) = σ_MIN + (s / 100) * (σ_MAX - σ_MIN)
//
// Ces valeurs sont des HYPOTHÈSES PÉDAGOGIQUES. Les performances passées
// ne garantissent pas les résultats futurs.

const ANCHOR_MIN = { mu: 0.02, sigma: 0.03 }; // note 0  — cash / fonds euros
const ANCHOR_MAX = { mu: 0.08, sigma: 0.18 }; // note 100 — 100 % actions mondiales

const N_SIMULATIONS = 7000;
const INFLATION_HYPOTHESE = 0.02;

/**
 * Retourne (μ, σ) interpolés pour une note de risque s ∈ [0, 100].
 * En mode nominal (inflation=false), ajoute 2 % à μ.
 * @param {number}  s         Note de risque 0-100
 * @param {boolean} inflation true = euros constants (μ réel), false = nominal
 */
function getMuSigma(s, inflation = false) {
  const t = Math.max(0, Math.min(100, s)) / 100;
  const mu    = ANCHOR_MIN.mu    + t * (ANCHOR_MAX.mu    - ANCHOR_MIN.mu);
  const sigma = ANCHOR_MIN.sigma + t * (ANCHOR_MAX.sigma - ANCHOR_MIN.sigma);
  return { mu: inflation ? mu : mu + INFLATION_HYPOTHESE, sigma };
}

/**
 * Convertit une note 0-100 en SRI 1-7 (indicateur de risque PRIIP/DIC).
 * Formule indicative : SRI ≈ 1 + round(score / 100 * 6).
 * Affiché à titre informatif uniquement.
 */
function scoreToSri(s) {
  return 1 + Math.round(Math.max(0, Math.min(100, s)) / 100 * 6);
}

// Box-Muller : génère une valeur suivant N(0,1)
function randn() {
  let u, v;
  do { u = Math.random(); v = Math.random(); } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Retourne le montant d'épargne mensuelle applicable à une année donnée,
 * selon un tableau de paliers [{annee_debut, montant_mensuel}, ...].
 * Le premier palier doit avoir annee_debut = 0.
 * @param {Array}  paliers  Triés par annee_debut croissant
 * @param {number} annee    Année courante (0-based)
 */
function epargneForAnnee(paliers, annee) {
  let montant = 0;
  for (const p of paliers) {
    if (p.annee_debut <= annee) montant = p.montant_mensuel;
    else break;
  }
  return montant;
}

/**
 * Simule la trajectoire complète année par année (Monte-Carlo).
 * Retourne un tableau de { annee, p5, p20, p50, p80, p95 } de l'année 0 à horizonAnnees.
 *
 * @param {number}  montantActuel  Capital de départ (€)
 * @param {Array}   paliers        [{annee_debut:0, montant_mensuel:X}, ...]
 * @param {number}  horizonAnnees  Durée en années entières
 * @param {number}  noteRisque     Score de risque 0-100
 * @param {boolean} inflation      true = euros constants, false = nominal (défaut)
 */
function simulateTrajectory(montantActuel, paliers, horizonAnnees, noteRisque, inflation = false) {
  const { mu, sigma } = getMuSigma(noteRisque, inflation);

  const snapshots = Array.from({ length: horizonAnnees + 1 }, () => new Array(N_SIMULATIONS));

  for (let i = 0; i < N_SIMULATIONS; i++) {
    let capital = montantActuel;
    snapshots[0][i] = capital;
    for (let annee = 0; annee < horizonAnnees; annee++) {
      const r = mu + sigma * randn();
      const tauxMensuel = Math.pow(1 + r, 1 / 12) - 1;
      const epargne = epargneForAnnee(paliers, annee);
      for (let m = 0; m < 12; m++) {
        capital = capital * (1 + tauxMensuel) + epargne;
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

/** Version finale uniquement (dernière année). */
function simulateProjection(montantActuel, paliers, horizonAnnees, noteRisque, inflation = false) {
  const traj = simulateTrajectory(montantActuel, paliers, horizonAnnees, noteRisque, inflation);
  return traj[traj.length - 1];
}

/**
 * Mode inverse A — Combien épargner par mois (palier 0) ?
 * Recherche binaire, 30 itérations ≈ précision < 1 €.
 * Retourne le montant mensuel du premier palier, ou Infinity si impossible.
 */
function findEpargneMensuelle(montantActuel, cible, horizonAnnees, noteRisque, inflation = false) {
  const paliers0 = m => [{ annee_debut: 0, montant_mensuel: m }];
  if (simulateProjection(montantActuel, paliers0(0), horizonAnnees, noteRisque, inflation).p50 >= cible) return 0;
  let lo = 0, hi = 100000;
  if (simulateProjection(montantActuel, paliers0(hi), horizonAnnees, noteRisque, inflation).p50 < cible) return Infinity;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    if (simulateProjection(montantActuel, paliers0(mid), horizonAnnees, noteRisque, inflation).p50 >= cible) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

/**
 * Mode inverse B — En combien de temps ?
 * Retourne le premier horizon (années) où P50 atteint la cible, ou null si > 50 ans.
 */
function findHorizon(montantActuel, paliers, cible, noteRisque, inflation = false) {
  const traj = simulateTrajectory(montantActuel, paliers, 50, noteRisque, inflation);
  const hit = traj.find(t => t.p50 >= cible);
  return hit ? hit.annee : null;
}

// Export pour les tests Node et pour l'UI
if (typeof module !== 'undefined') {
  module.exports = {
    getMuSigma, scoreToSri, epargneForAnnee,
    simulateProjection, simulateTrajectory,
    findEpargneMensuelle, findHorizon,
    ANCHOR_MIN, ANCHOR_MAX, INFLATION_HYPOTHESE,
  };
}
