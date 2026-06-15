// ═══ MOTEUR DE COHÉRENCE — ÉTAPE 1 ═══════════════════════════════════════════
//
// Fonctions pures, déterministes, sans effet de bord.
// Dépend de objectifs.js : epargneForAnnee, getMuSigma, simulateTrajectory,
// ANCHOR_MIN, ANCHOR_MAX, INFLATION_HYPOTHESE.
// En browser : ces noms sont des globales (objectifs.js chargé avant).
// En Node    : injectés via global.xxx dans le fichier de tests.

// ── CONSTANTE RISQUE/HORIZON ──────────────────────────────────────────────────
// Hypothèse éditable : points de note_risque "justifiés" par année d'horizon.
// Référence : règle empirique classique (gestion de patrimoine, "% actions ≤ horizon").
// Ex : horizon 10 ans → note_risque max autorisée = min(100, 10 × 10) = 100.
const RISQUE_PAR_AN = 10;

// ── UTILITAIRES PRIVÉS ────────────────────────────────────────────────────────

function _normPC(p) {
  return (Array.isArray(p) && p.length) ? p : [{ annee_debut: 0, montant_mensuel: 0 }];
}

// Capital après 1 an avec versements mensuels m, taux annuel r (déterministe).
function _annee(capital, m, r) {
  if (Math.abs(r) < 1e-12) return capital + 12 * m;
  const tm = Math.pow(1 + r, 1 / 12) - 1;
  return capital * (1 + r) + m * ((1 + r) - 1) / tm;
}

// Simulation déterministe : capital final à horizon années, taux annuel r.
function _simDet(montantActuel, paliers, horizonAnnees, r) {
  let cap = montantActuel;
  for (let a = 0; a < horizonAnnees; a++) {
    cap = _annee(cap, epargneForAnnee(paliers, a), r);
  }
  return cap;
}

// Décale tous les paliers d'un même montant delta (€/mois).
function _shiftPaliers(paliers, delta) {
  return paliers.map(p => ({ annee_debut: p.annee_debut, montant_mensuel: Math.max(0, p.montant_mensuel + delta) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. note_risque_max_horizon(horizon)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Note de risque maximale cohérente avec un horizon donné.
 * Formule : min(100, horizon × RISQUE_PAR_AN).
 * @param {number} horizon  Durée en années
 * @returns {number}        Note 0-100
 */
function note_risque_max_horizon(horizon) {
  return Math.min(100, Math.max(0, horizon) * RISQUE_PAR_AN);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. rendement_requis(objectif)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Taux annuel déterministe r tel que la simulation en capital composé
 * (+ versements mensuels paliers) atteigne exactement montant_cible.
 * Recherche par bissection dans [0 %, 20 %].
 *
 * @param {{ montant_actuel, montant_cible, horizon_annees, paliers_epargne }} objectif
 * @returns {{
 *   taux: number|null,        // taux annuel requis (0 si sur-financé)
 *   surFinance: boolean,      // vrai si r=0 % suffit déjà
 *   hors_plage: boolean,      // vrai si r=20 % ne suffit pas
 *   capital_a_20pct: number|null  // capital atteint à 20 % (si hors_plage)
 * }}
 */
function rendement_requis(objectif) {
  const paliers = _normPC(objectif.paliers_epargne);
  const { montant_actuel, montant_cible, horizon_annees } = objectif;

  const f = r => _simDet(montant_actuel, paliers, horizon_annees, r);

  // Cas sur-financé : r=0 % suffit déjà
  if (f(0) >= montant_cible) {
    return { taux: 0, surFinance: true, hors_plage: false, capital_a_20pct: null };
  }

  // Cas hors plage : même r=20 % ne suffit pas
  const cap20 = f(0.20);
  if (cap20 < montant_cible) {
    return { taux: null, surFinance: false, hors_plage: true, capital_a_20pct: cap20 };
  }

  // Bissection dans [0, 20 %]
  let lo = 0, hi = 0.20;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= montant_cible) hi = mid;
    else lo = mid;
  }
  return { taux: hi, surFinance: false, hors_plage: false, capital_a_20pct: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. analyser_coherence(objectif, profil)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Analyse la cohérence entre un objectif et le profil utilisateur.
 * Retourne un objet structuré avec verdict, médianes, 3 leviers, alerte et priorités.
 *
 * @param {{
 *   montant_actuel, montant_cible, horizon_annees, note_risque, paliers_epargne
 * }} objectif
 * @param {{
 *   score_tolerance?, score_capacite?,
 *   age_actuel?, age_limite_horizon?,
 *   disponible_mensuel?
 * }} profil
 * @returns {object}
 */
function analyser_coherence(objectif, profil) {
  const { montant_actuel, montant_cible, horizon_annees, note_risque } = objectif;
  const paliers = _normPC(objectif.paliers_epargne);
  const {
    score_tolerance   = 50,
    score_capacite    = 50,
    age_actuel        = 35,
    age_limite_horizon = 65,
    disponible_mensuel = 0,
  } = (profil || {});

  // ── a) Score combiné ────────────────────────────────────────────────────────
  const score_combine = Math.min(score_tolerance, score_capacite);

  // ── b) Rendement requis (déterministe) ─────────────────────────────────────
  const rq = rendement_requis(objectif);

  // ── c) Note de risque requise (inverse de getMuSigma nominal) ──────────────
  // getMuSigma(s, false).mu = ANCHOR_MIN.mu + (s/100)*range + INFLATION_HYPOTHESE
  // → s = ((r - INFLATION_HYPOTHESE) - ANCHOR_MIN.mu) / range * 100
  let s_requis;
  if (rq.hors_plage) {
    s_requis = 100;
  } else if (rq.surFinance) {
    s_requis = 0;
  } else {
    const range = ANCHOR_MAX.mu - ANCHOR_MIN.mu;
    const t = (rq.taux - INFLATION_HYPOTHESE - ANCHOR_MIN.mu) / range;
    s_requis = Math.max(0, Math.min(100, t * 100));
  }

  // ── d) Verdict : P50 Monte-Carlo >= cible ? ─────────────────────────────────
  const traj = simulateTrajectory(montant_actuel, paliers, horizon_annees, note_risque, false);
  const last  = traj[traj.length - 1];
  const verdict = last.p50 >= montant_cible;

  // ── h) Alerte risque/horizon ────────────────────────────────────────────────
  const max_risque_horizon = note_risque_max_horizon(horizon_annees);
  const alerte_horizon = note_risque > max_risque_horizon
    ? { note_actuelle: note_risque, max_pour_horizon: max_risque_horizon }
    : null;

  // Taux attendu déterministe à la note actuelle
  const r_actuel = getMuSigma(note_risque, false).mu;
  const palier0  = paliers[0].montant_mensuel;

  // ── e) Levier RISQUE ─────────────────────────────────────────────────────────
  const plafond_risque       = Math.min(score_combine, max_risque_horizon);
  const adj_requis_risque    = s_requis - note_risque;
  const marge_risque         = plafond_risque - note_risque;
  const adj_possible_risque  = Math.max(-note_risque, Math.min(adj_requis_risque, marge_risque));

  let median_au_plafond_risque = null;
  if (adj_requis_risque > marge_risque && marge_risque > 0) {
    const note_max = note_risque + marge_risque;
    const traj_max = simulateTrajectory(montant_actuel, paliers, horizon_annees, note_max, false);
    median_au_plafond_risque = traj_max[traj_max.length - 1].p50;
  }

  const effort_risque = marge_risque <= 0 ? Infinity : Math.abs(adj_requis_risque) / Math.abs(marge_risque);

  const levier_risque = {
    ajustement_requis:  adj_requis_risque,
    marge_disponible:   marge_risque,
    ajustement_possible: adj_possible_risque,
    effort_relatif:     effort_risque,
    median_au_plafond:  median_au_plafond_risque,
  };

  // ── f) Levier ÉPARGNE ─────────────────────────────────────────────────────────
  const marge_epargne = disponible_mensuel - palier0;

  const fEpargne = d => _simDet(montant_actuel, _shiftPaliers(paliers, d), horizon_annees, r_actuel);
  const capDet0  = fEpargne(0);
  let adj_requis_epargne;

  if (capDet0 >= montant_cible) {
    // Sur-financé au taux attendu : cherche le delta négatif minimal
    if (fEpargne(-palier0) >= montant_cible) {
      adj_requis_epargne = -palier0; // même à 0 € d'épargne, c'est suffisant
    } else {
      let lo = -palier0, hi = 0;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fEpargne(mid) >= montant_cible) hi = mid;
        else lo = mid;
      }
      adj_requis_epargne = hi; // négatif
    }
  } else {
    const maxDelta = 20000;
    if (fEpargne(maxDelta) < montant_cible) {
      adj_requis_epargne = maxDelta; // flag : même +20 k€/mois ne suffit pas
    } else {
      let lo = 0, hi = maxDelta;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fEpargne(mid) >= montant_cible) hi = mid;
        else lo = mid;
      }
      adj_requis_epargne = hi;
    }
  }

  const adj_possible_epargne = Math.max(-palier0, Math.min(adj_requis_epargne, marge_epargne));

  const median_au_plafond_epargne = (adj_requis_epargne > marge_epargne && marge_epargne > 0)
    ? fEpargne(marge_epargne)
    : null;

  const effort_epargne = marge_epargne <= 0 ? Infinity : Math.abs(adj_requis_epargne) / Math.abs(marge_epargne);

  const levier_epargne = {
    ajustement_requis:   adj_requis_epargne,
    marge_disponible:    marge_epargne,
    ajustement_possible: adj_possible_epargne,
    effort_relatif:      effort_epargne,
    median_au_plafond:   median_au_plafond_epargne,
  };

  // ── g) Levier HORIZON ─────────────────────────────────────────────────────────
  // _simDet avec un horizon étendu prolonge automatiquement le dernier palier
  // (epargneForAnnee retourne le dernier palier actif pour toute année au-delà).
  const marge_horizon = (age_limite_horizon - age_actuel) - horizon_annees;

  const fHorizon = dh => _simDet(montant_actuel, paliers, horizon_annees + dh, r_actuel);

  let adj_requis_horizon;
  if (fHorizon(0) >= montant_cible) {
    adj_requis_horizon = 0;
  } else {
    const maxDH = 50;
    if (fHorizon(maxDH) < montant_cible) {
      adj_requis_horizon = maxDH;
    } else {
      let lo = 0, hi = maxDH;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fHorizon(mid) >= montant_cible) hi = mid;
        else lo = mid;
      }
      adj_requis_horizon = Math.ceil(hi); // arrondi à l'année supérieure
    }
  }

  const adj_possible_horizon = Math.max(0, Math.min(adj_requis_horizon, marge_horizon));

  let median_au_plafond_horizon = null;
  if (adj_requis_horizon > marge_horizon && marge_horizon > 0) {
    median_au_plafond_horizon = fHorizon(marge_horizon);
  }

  const effort_horizon = marge_horizon <= 0 ? Infinity : Math.abs(adj_requis_horizon) / Math.abs(marge_horizon);

  const levier_horizon = {
    ajustement_requis:   adj_requis_horizon,
    marge_disponible:    marge_horizon,
    ajustement_possible: adj_possible_horizon,
    effort_relatif:      effort_horizon,
    median_au_plafond:   median_au_plafond_horizon,
  };

  // ── i) Priorité des leviers ───────────────────────────────────────────────────
  const ordre_priorite = [
    { nom: 'risque',  effort: effort_risque  },
    { nom: 'epargne', effort: effort_epargne },
    { nom: 'horizon', effort: effort_horizon },
  ]
    .sort((a, b) => a.effort - b.effort)
    .map(l => l.nom);

  return {
    verdict,
    mediane:       last.p50,
    p5:            last.p5,
    p95:           last.p95,
    r_requis:      rq,
    s_requis,
    score_combine,
    alerte_horizon,
    levier_risque,
    levier_epargne,
    levier_horizon,
    ordre_priorite,
  };
}

// Export pour les tests Node et pour l'UI
if (typeof module !== 'undefined') {
  module.exports = {
    RISQUE_PAR_AN,
    note_risque_max_horizon,
    rendement_requis,
    analyser_coherence,
  };
}
