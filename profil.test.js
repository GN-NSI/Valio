// Tests unitaires du moteur de profil de risque — node profil.test.js
const {
  QUESTIONS_TOLERANCE,
  calcToleranceScore,
  calcCapaciteScore,
  niveauTolerance,
  niveauCapacite,
  SEUIL_PRECAUTION_EXCES_MOIS,
} = require('./profil.js');

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

console.log('\n── Scoring tolérance ──\n');

// Profil maximal : toutes les réponses à 4
const reponsesMax = Object.fromEntries(QUESTIONS_TOLERANCE.map(q => [q.id, 4]));
assert('Score max = 100', calcToleranceScore(reponsesMax) === 100);

// Profil minimal : toutes les réponses à 0
const reponsesMin = Object.fromEntries(QUESTIONS_TOLERANCE.map(q => [q.id, 0]));
assert('Score min = 0', calcToleranceScore(reponsesMin) === 0);

// Score entre 0 et 100 pour des réponses aléatoires
const reponsesMid = Object.fromEntries(QUESTIONS_TOLERANCE.map(q => [q.id, 2]));
const scoreMid = calcToleranceScore(reponsesMid);
assert('Score médian dans [0, 100]', scoreMid >= 0 && scoreMid <= 100);

// Plus les réponses sont élevées, plus le score est élevé
const reponsesHaut = Object.fromEntries(QUESTIONS_TOLERANCE.map(q => [q.id, 3]));
const reponsesBas  = Object.fromEntries(QUESTIONS_TOLERANCE.map(q => [q.id, 1]));
assert('Réponses hautes → score plus élevé', calcToleranceScore(reponsesHaut) > calcToleranceScore(reponsesBas));

// Réponse manquante → erreur
try {
  calcToleranceScore({ q1: 2 });
  assert('Réponse manquante → erreur levée', false);
} catch(e) {
  assert('Réponse manquante → erreur levée', true);
}

// Valeur invalide → erreur
try {
  const rep = { ...reponsesMin, q1: 5 };
  calcToleranceScore(rep);
  assert('Valeur > 4 → erreur levée', false);
} catch(e) {
  assert('Valeur > 4 → erreur levée', true);
}

console.log('\n── Scoring capacité ──\n');

// Cas : épargne < 3 mois → score bas
const { score: scoreFaible } = calcCapaciteScore(3000, 2000, 3000); // 1.5 mois
assert('Épargne < 3 mois → score < 34', scoreFaible < 34);

// Cas : épargne 3-6 mois → score moyen
const { score: scoreMoyen } = calcCapaciteScore(3000, 2000, 8000); // 4 mois
assert('Épargne 3-6 mois → score dans [34, 66]', scoreMoyen >= 34 && scoreMoyen <= 66);

// Cas : épargne > 6 mois → score élevé
const { score: scoreEleve } = calcCapaciteScore(4000, 2000, 20000); // 10 mois
assert('Épargne > 6 mois → score > 50', scoreEleve > 50);

// Taux d'épargne positif améliore le score
const { score: scoreAvecEpargne } = calcCapaciteScore(4000, 2000, 12000); // surplus 2000€/mois
const { score: scoreSansEpargne } = calcCapaciteScore(2000, 2000, 12000); // équilibre exact
assert('Taux d\'épargne positif → score plus élevé', scoreAvecEpargne > scoreSansEpargne);

// Déficit mensuel (dépenses > revenus) → malus
const { score: scoreDeficit } = calcCapaciteScore(1500, 2000, 10000);
const { score: scoreEquilibre } = calcCapaciteScore(2000, 2000, 10000);
assert('Déficit mensuel → score plus bas qu\'équilibre', scoreDeficit < scoreEquilibre);

// Score toujours dans [0, 100]
const cas = [
  [0, 0, 0], [5000, 4800, 0], [10000, 500, 200000], [1000, 2000, 500],
];
for (const [r, c, e] of cas) {
  const { score } = calcCapaciteScore(r, c, e);
  assert(`calcCapaciteScore(${r},${c},${e}) ∈ [0,100]`, score >= 0 && score <= 100);
}

// Message informatif si épargne excessive
const { message } = calcCapaciteScore(3000, 1000, 20000); // 20 mois > seuil 15
assert(`Message informatif si épargne > ${SEUIL_PRECAUTION_EXCES_MOIS} mois`, message !== null);

const { message: pasDeMsgSi6Mois } = calcCapaciteScore(3000, 1000, 6000); // 6 mois
assert('Pas de message si épargne raisonnable', pasDeMsgSi6Mois === null);

console.log('\n── Interprétation des scores ──\n');

assert('Score 0 → tolérance Prudente',  niveauTolerance(0).label === 'Prudente');
assert('Score 50 → tolérance Modérée',  niveauTolerance(50).label === 'Modérée');
assert('Score 100 → tolérance Élevée',  niveauTolerance(100).label === 'Élevée');
assert('Score 0 → capacité Limitée',    niveauCapacite(0).label === 'Limitée');
assert('Score 50 → capacité Correcte',  niveauCapacite(50).label === 'Correcte');
assert('Score 100 → capacité Solide',   niveauCapacite(100).label === 'Solide');

console.log(`\n${passed + failed} tests — ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
