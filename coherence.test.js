// Tests unitaires du moteur de cohérence — node coherence.test.js
//
// Injecte les dépendances de objectifs.js en globales avant de charger coherence.js.

const _obj = require('./objectifs.js');
global.epargneForAnnee    = _obj.epargneForAnnee;
global.getMuSigma         = _obj.getMuSigma;
global.simulateTrajectory = _obj.simulateTrajectory;
global.ANCHOR_MIN         = _obj.ANCHOR_MIN;
global.ANCHOR_MAX         = _obj.ANCHOR_MAX;
global.INFLATION_HYPOTHESE = _obj.INFLATION_HYPOTHESE;

const { note_risque_max_horizon, rendement_requis, analyser_coherence } = require('./coherence.js');

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}
function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

// ── note_risque_max_horizon ────────────────────────────────────────────────
console.log('\n── note_risque_max_horizon ──\n');

assert('horizon 0  → 0',   note_risque_max_horizon(0)  === 0);
assert('horizon 5  → 50',  note_risque_max_horizon(5)  === 50);
assert('horizon 10 → 100', note_risque_max_horizon(10) === 100);
assert('horizon 15 → 100 (plafonné)', note_risque_max_horizon(15) === 100);
assert('horizon 1  → 10',  note_risque_max_horizon(1)  === 10);

// ── rendement_requis ───────────────────────────────────────────────────────
console.log('\n── rendement_requis ──\n');

// Cas sur-financé : capital initial suffit sans rendement
const rqSF = rendement_requis({
  montant_actuel: 200000, montant_cible: 50000,
  horizon_annees: 5, paliers_epargne: [{ annee_debut: 0, montant_mensuel: 0 }],
});
assert('sur-financé : surFinance=true',         rqSF.surFinance === true);
assert('sur-financé : taux=0',                  rqSF.taux === 0);
assert('sur-financé : hors_plage=false',         rqSF.hors_plage === false);

// Cas sur-financé avec épargne importante
const rqSF2 = rendement_requis({
  montant_actuel: 0, montant_cible: 50000,
  horizon_annees: 10, paliers_epargne: [{ annee_debut: 0, montant_mensuel: 600 }],
});
assert('sur-financé via épargne : surFinance=true (600×12×10=72k>50k)', rqSF2.surFinance === true);

// Cas hors plage : objectif inatteignable à 20 %
const rqHP = rendement_requis({
  montant_actuel: 0, montant_cible: 1000000,
  horizon_annees: 5, paliers_epargne: [{ annee_debut: 0, montant_mensuel: 0 }],
});
assert('hors plage : hors_plage=true',          rqHP.hors_plage === true);
assert('hors plage : taux=null',                rqHP.taux === null);
assert('hors plage : capital_a_20pct est un nombre', typeof rqHP.capital_a_20pct === 'number');
assert('hors plage : capital_a_20pct > 0',      rqHP.capital_a_20pct > 0);

// Cas normal : taux entre 0 et 20 %
const rqN = rendement_requis({
  montant_actuel: 10000, montant_cible: 50000,
  horizon_annees: 10, paliers_epargne: [{ annee_debut: 0, montant_mensuel: 150 }],
});
assert('normal : hors_plage=false',  rqN.hors_plage === false);
assert('normal : surFinance=false',  rqN.surFinance  === false);
assert('normal : 0 < taux < 0.20',  rqN.taux > 0 && rqN.taux < 0.20);

// Vérification : le taux calculé redonne bien la cible (précision < 1 €)
{
  const { taux } = rqN;
  const paliers  = [{ annee_debut: 0, montant_mensuel: 150 }];
  let cap = 10000;
  for (let a = 0; a < 10; a++) {
    const tm = Math.pow(1 + taux, 1/12) - 1;
    cap = cap * (1 + taux) + 150 * ((1 + taux) - 1) / tm;
  }
  assert('normal : capital final ≈ 50 000 € (±1 €)', near(cap, 50000, 1));
}

// Plus d'épargne → taux requis plus faible
const rqMoins = rendement_requis({
  montant_actuel: 10000, montant_cible: 50000,
  horizon_annees: 10, paliers_epargne: [{ annee_debut: 0, montant_mensuel: 300 }],
});
assert('plus d\'épargne → taux requis plus faible', rqMoins.taux < rqN.taux);

// ── analyser_coherence ─────────────────────────────────────────────────────
console.log('\n── analyser_coherence ──\n');

// ── Cas 1 : objectif déjà cohérent (P50 >> cible) ──────────────────────────
const objCoherent = {
  montant_actuel: 50000, montant_cible: 60000,
  horizon_annees: 20, note_risque: 50,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 500 }],
};
const profilStd = {
  score_tolerance: 60, score_capacite: 70,
  age_actuel: 35, age_limite_horizon: 65,
  disponible_mensuel: 2000,
};
const rCoherent = analyser_coherence(objCoherent, profilStd);
assert('cohérent : verdict=true',                rCoherent.verdict === true);
assert('cohérent : mediane est un nombre > 0',   rCoherent.mediane > 0);
assert('cohérent : P5 < mediane < P95',
  rCoherent.p5 < rCoherent.mediane && rCoherent.mediane < rCoherent.p95);
assert('cohérent : score_combine = min(tol,cap)', rCoherent.score_combine === 60);
assert('cohérent : ordre_priorite a 3 éléments', rCoherent.ordre_priorite.length === 3);
assert('cohérent : ordre_priorite contient les 3 leviers',
  ['risque','epargne','horizon'].every(n => rCoherent.ordre_priorite.includes(n)));
assert('cohérent : levier_risque.ajustement_requis <= 0 (risque ok ou réductible)',
  rCoherent.levier_risque.ajustement_requis <= 0);

// ── Cas 2 : objectif incohérent, un seul levier suffisant (épargne) ────────
const objIncoherent = {
  montant_actuel: 0, montant_cible: 100000,
  horizon_annees: 10, note_risque: 40,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 300 }],
};
const profilLarge = {
  score_tolerance: 70, score_capacite: 80,
  age_actuel: 30, age_limite_horizon: 65,
  disponible_mensuel: 2000,
};
const rInco = analyser_coherence(objIncoherent, profilLarge);
assert('incohérent : verdict=false',             rInco.verdict === false);
assert('incohérent : levier_epargne.ajustement_requis > 0', rInco.levier_epargne.ajustement_requis > 0);
assert('incohérent : levier_epargne.marge_disponible > 0',  rInco.levier_epargne.marge_disponible > 0);
assert('incohérent : levier_horizon.ajustement_requis > 0', rInco.levier_horizon.ajustement_requis > 0);

// ── Cas 3 : objectif sur-financé côté risque (note_risque peut baisser) ────
const objSurFinance = {
  montant_actuel: 200000, montant_cible: 150000,
  horizon_annees: 5, note_risque: 80,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 1000 }],
};
const rSF = analyser_coherence(objSurFinance, profilStd);
assert('sur-financé : verdict=true',             rSF.verdict === true);
assert('sur-financé : s_requis=0',               rSF.s_requis === 0);
assert('sur-financé : levier_risque.ajustement_requis < 0 (peut réduire)',
  rSF.levier_risque.ajustement_requis < 0);
assert('sur-financé : levier_risque.ajustement_possible < 0',
  rSF.levier_risque.ajustement_possible < 0);

// ── Cas 4 : aucun levier seul ne suffit (lacune trop grande) ───────────────
const objTropAmbitieux = {
  montant_actuel: 0, montant_cible: 500000,
  horizon_annees: 5, note_risque: 30,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 100 }],
};
const profilEtroit = {
  score_tolerance: 35, score_capacite: 40,
  age_actuel: 55, age_limite_horizon: 60,
  disponible_mensuel: 500,
};
const rAmbi = analyser_coherence(objTropAmbitieux, profilEtroit);
assert('trop ambitieux : verdict=false',         rAmbi.verdict === false);
assert('trop ambitieux : levier_risque.effort_relatif > 1 (ajustement > marge)',
  rAmbi.levier_risque.effort_relatif > 1);
assert('trop ambitieux : levier_epargne.effort_relatif > 1',
  rAmbi.levier_epargne.effort_relatif > 1);
assert('trop ambitieux : levier_horizon.effort_relatif > 1',
  rAmbi.levier_horizon.effort_relatif > 1);
// Quand ajustement_requis > marge, median_au_plafond doit être renseigné pour les leviers avec marge > 0
assert('trop ambitieux : levier_risque.median_au_plafond est un nombre (marge>0)',
  rAmbi.levier_risque.marge_disponible > 0
    ? typeof rAmbi.levier_risque.median_au_plafond === 'number'
    : true);

// ── Cas 5 : alerte risque/horizon (note trop haute pour l'horizon) ──────────
const objAlerteHorizon = {
  montant_actuel: 20000, montant_cible: 30000,
  horizon_annees: 3, note_risque: 80,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 200 }],
};
const rAlerte = analyser_coherence(objAlerteHorizon, profilStd);
assert('alerte horizon : alerte_horizon non null',   rAlerte.alerte_horizon !== null);
assert('alerte horizon : note_actuelle = 80',        rAlerte.alerte_horizon.note_actuelle === 80);
assert('alerte horizon : max_pour_horizon = 30',     rAlerte.alerte_horizon.max_pour_horizon === 30);

// Pas d'alerte si note cohérente avec horizon
const objSansAlerte = {
  montant_actuel: 10000, montant_cible: 20000,
  horizon_annees: 10, note_risque: 50,
  paliers_epargne: [{ annee_debut: 0, montant_mensuel: 0 }],
};
const rSansAlerte = analyser_coherence(objSansAlerte, profilStd);
assert('sans alerte : alerte_horizon null', rSansAlerte.alerte_horizon === null);

// ── Structure et typage ─────────────────────────────────────────────────────
console.log('\n── structure retournée ──\n');
const r = analyser_coherence(objIncoherent, profilLarge);
assert('r.verdict est boolean',         typeof r.verdict === 'boolean');
assert('r.ordre_priorite est un array', Array.isArray(r.ordre_priorite));
assert('levier_risque a tous les champs',
  ['ajustement_requis','marge_disponible','ajustement_possible','effort_relatif','median_au_plafond']
    .every(k => k in r.levier_risque));
assert('levier_epargne a tous les champs',
  ['ajustement_requis','marge_disponible','ajustement_possible','effort_relatif','median_au_plafond']
    .every(k => k in r.levier_epargne));
assert('levier_horizon a tous les champs',
  ['ajustement_requis','marge_disponible','ajustement_possible','effort_relatif','median_au_plafond']
    .every(k => k in r.levier_horizon));

// Priorité : le levier le plus facile doit avoir le plus faible effort_relatif
{
  const leviers = {
    risque:  r.levier_risque.effort_relatif,
    epargne: r.levier_epargne.effort_relatif,
    horizon: r.levier_horizon.effort_relatif,
  };
  const premier = r.ordre_priorite[0];
  const effortPremier = leviers[premier];
  const tousSuperieur = r.ordre_priorite.every(n => leviers[n] >= effortPremier);
  assert('priorité : premier levier a le plus faible effort_relatif', tousSuperieur);
}

console.log(`\n${passed + failed} tests — ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
