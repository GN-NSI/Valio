// ═══ QUESTIONNAIRE DE PROFIL DE RISQUE ═══════════════════════════════════════
//
// Deux scores indépendants (0-100) :
//   - score_tolerance : tolérance psychologique au risque (10 questions)
//   - score_capacite  : capacité financière à prendre du risque (3 données chiffrées)
//
// Budget de risque utilisable = min(score_tolerance, score_capacite)
// Ce minimum est affiché comme constat, jamais comme prescription.

// ─── QUESTIONS DE TOLÉRANCE (10 questions, 0-4 pts chacune → total 0-40) ───
// Format : { id, texte, options: [{ texte, pts }] }
const QUESTIONS_TOLERANCE = [
  {
    id: 'q1',
    texte: 'Ton portefeuille de 10 000 € vaut soudain 7 000 € (−30 %) après un krach. Tu fais quoi ?',
    options: [
      { texte: 'Je vends tout pour limiter les pertes',                           pts: 0 },
      { texte: 'J\'attends, mais je surveille anxieusement chaque jour',          pts: 1 },
      { texte: 'J\'attends sans trop m\'inquiéter, c\'est temporaire',            pts: 2 },
      { texte: 'Je renforce légèrement ma position',                              pts: 3 },
      { texte: 'Je renforce significativement — c\'est une opportunité',          pts: 4 },
    ],
  },
  {
    id: 'q2',
    texte: 'Sur 10 ans, tu préfères : A) 3 %/an certain, ou B) 50 % de chances de faire 9 %/an / 50 % de chances de faire 0 %/an ?',
    options: [
      { texte: 'A sans hésiter — la certitude avant tout',                        pts: 0 },
      { texte: 'Plutôt A, je préfère la sécurité',                               pts: 1 },
      { texte: 'Indécis entre les deux',                                          pts: 2 },
      { texte: 'Plutôt B, le potentiel m\'attire',                               pts: 3 },
      { texte: 'B sans hésiter — l\'espérance de gain est clairement supérieure', pts: 4 },
    ],
  },
  {
    id: 'q3',
    texte: 'Tu peux supporter de voir ton capital en moins-value pendant combien de temps ?',
    options: [
      { texte: 'Aucune tolérance — je ne supporte pas de voir mon capital baisser', pts: 0 },
      { texte: '1 à 3 mois maximum',                                               pts: 1 },
      { texte: 'Environ 1 an',                                                     pts: 2 },
      { texte: '2 à 3 ans',                                                        pts: 3 },
      { texte: 'Plus de 3 ans — l\'horizon long terme me suffit',                  pts: 4 },
    ],
  },
  {
    id: 'q4',
    texte: 'Tu reçois une prime imprévue de 3 000 €. Tu...',
    options: [
      { texte: 'Mets tout sur un livret ou compte sécurisé',                       pts: 0 },
      { texte: 'Investis 25 %, sécurises 75 %',                                    pts: 1 },
      { texte: 'Partages en deux (50 % investi / 50 % sécurisé)',                  pts: 2 },
      { texte: 'Investis 75 %, gardes 25 % de côté',                              pts: 3 },
      { texte: 'Investis la totalité',                                              pts: 4 },
    ],
  },
  {
    id: 'q5',
    texte: 'Tu avais 5 000 € sur livret. Cette année les marchés ont fait +25 %. Tu te sens...',
    options: [
      { texte: 'Soulagé d\'avoir protégé mon capital — les marchés auraient pu baisser aussi', pts: 0 },
      { texte: 'Légèrement frustré, mais c\'était mon choix et je l\'assume',                  pts: 1 },
      { texte: 'Partagé — j\'aurais dû en investir une partie',                               pts: 2 },
      { texte: 'Franchement frustré d\'avoir raté cette hausse',                              pts: 3 },
      { texte: 'Très frustré — je repositionne une bonne partie maintenant',                  pts: 4 },
    ],
  },
  {
    id: 'q6',
    texte: 'As-tu déjà subi une perte significative (> 10 %) sur un investissement ?',
    options: [
      { texte: 'Non, et l\'idée seule m\'inquiète beaucoup',                        pts: 0 },
      { texte: 'Non, mais je pense que ça me perturberait fortement',               pts: 1 },
      { texte: 'Non, mais je pense pouvoir le gérer',                               pts: 2 },
      { texte: 'Oui — ça m\'a perturbé, mais j\'ai maintenu ma stratégie',         pts: 3 },
      { texte: 'Oui — je suis resté calme et je me suis adapté',                   pts: 4 },
    ],
  },
  {
    id: 'q7',
    texte: 'Tu as 10 000 € à investir. On te propose une seule entreprise prometteuse ou 20 entreprises diversifiées. Tu...',
    options: [
      { texte: 'Diversifie absolument — la concentration me dérange',               pts: 0 },
      { texte: 'Mets 10-15 % dans l\'entreprise, le reste diversifié',             pts: 1 },
      { texte: 'Partages à peu près en deux',                                       pts: 2 },
      { texte: 'Mets 60-70 % dans l\'entreprise prometteuse',                      pts: 3 },
      { texte: 'Mets tout dans l\'entreprise — le potentiel est là',               pts: 4 },
    ],
  },
  {
    id: 'q8',
    texte: 'Tu as investi 10 000 € en bourse sur un horizon de 10 ans. À quelle fréquence consultes-tu la valeur de ton portefeuille ?',
    options: [
      { texte: 'Plusieurs fois par jour — je surveille constamment',                pts: 0 },
      { texte: 'Chaque jour',                                                       pts: 1 },
      { texte: 'Une fois par semaine',                                              pts: 2 },
      { texte: 'Une fois par mois',                                                 pts: 3 },
      { texte: 'Une fois par trimestre ou moins — l\'horizon long terme me suffit', pts: 4 },
    ],
  },
  {
    id: 'q9',
    texte: 'Un placement intéressant bloque ton argent pendant 5 ans mais offre un meilleur rendement. Tu...',
    options: [
      { texte: 'Refuse catégoriquement — mon argent doit rester disponible',        pts: 0 },
      { texte: 'Hésite beaucoup, l\'illiquidité m\'inquiète',                      pts: 1 },
      { texte: 'Acceptes si le rendement est nettement supérieur',                  pts: 2 },
      { texte: 'Acceptes facilement — 5 ans c\'est court sur un horizon long',     pts: 3 },
      { texte: 'Cherches activement ce type de placements longue durée',            pts: 4 },
    ],
  },
  {
    id: 'q10',
    texte: 'Face à de grandes hausses et baisses rapides des marchés, tu...',
    options: [
      { texte: 'Paniques — tu aurais du mal à rester rationnel',                    pts: 0 },
      { texte: 'Te sens dépassé, mais tu essaies de ne pas réagir impulsivement',  pts: 1 },
      { texte: 'Restes calme, mais tu préfères déléguer ou suivre des indices',    pts: 2 },
      { texte: 'Analyses la situation sereinement et ajustes ta stratégie',         pts: 3 },
      { texte: 'Te sens à l\'aise — c\'est dans ces moments que les opportunités émergent', pts: 4 },
    ],
  },
];

const TOTAL_POINTS_MAX = QUESTIONS_TOLERANCE.reduce((s, q) => s + 4, 0); // 40

/**
 * Calcule le score de tolérance psychologique (0-100).
 * @param {Object} reponses - { q1: 0-4, q2: 0-4, ... q10: 0-4 }
 * @returns {number} score arrondi 0-100
 */
function calcToleranceScore(reponses) {
  let total = 0;
  for (const q of QUESTIONS_TOLERANCE) {
    const val = reponses[q.id];
    if (val === undefined || val === null) throw new Error(`Réponse manquante : ${q.id}`);
    const pts = Number(val);
    if (pts < 0 || pts > 4) throw new Error(`Valeur invalide pour ${q.id} : ${pts}`);
    total += pts;
  }
  return Math.round((total / TOTAL_POINTS_MAX) * 100);
}


// ─── SCORING CAPACITÉ FINANCIÈRE ──────────────────────────────────────────────
//
// Entrées : revenus mensuels nets, charges fixes mensuelles, épargne de précaution
//
// Deux composantes :
//   1. Ratio de précaution = épargne_précaution / charges_fixes (nombre de mois couverts)
//   2. Taux d'épargne      = (revenus - charges) / revenus
//
// Seuils en CONSTANTES NOMMÉES — à ajuster si les standards évoluent.
// Référence : règles empiriques classiques en finance personnelle (source : AMF, livres de
// finance personnelle de référence). Ces valeurs sont des hypothèses par défaut, éditables.

// Seuils du ratio de précaution (mois de charges couverts)
const SEUILS_PRECAUTION = [
  { min: 0,   max: 3,   base: 20 },  // < 3 mois : situation fragile
  { min: 3,   max: 6,   base: 50 },  // 3-6 mois : coussin minimal recommandé
  { min: 6,   max: 12,  base: 75 },  // 6-12 mois : situation solide
  { min: 12,  max: Infinity, base: 90 }, // > 12 mois : très solide
];

// Bonus selon le taux d'épargne mensuel (revenus - charges) / revenus
const BONUS_TAUX_EPARGNE = [
  { min: -Infinity, max: 0,    bonus: -15 }, // dépenses > revenus : situation déficitaire
  { min: 0,         max: 0.05, bonus:   0 }, // 0-5 %
  { min: 0.05,      max: 0.15, bonus:   5 }, // 5-15 %
  { min: 0.15,      max: 0.25, bonus:  10 }, // 15-25 %
  { min: 0.25,      max: Infinity, bonus: 15 }, // > 25 %
];

// Seuil d'épargne de précaution "excessive" (au-delà, constat informatif)
const SEUIL_PRECAUTION_EXCES_MOIS = 15; // > 15 mois de charges

/**
 * Calcule le score de capacité financière (0-100) et retourne un message informatif si pertinent.
 * @param {number} revenus          Revenus mensuels nets (€)
 * @param {number} charges          Charges fixes mensuelles (€)
 * @param {number} epargnePrecaution Épargne de précaution disponible (€)
 * @returns {{ score: number, message: string|null }}
 */
function calcCapaciteScore(revenus, charges, epargnePrecaution) {
  if (revenus < 0 || charges < 0 || epargnePrecaution < 0)
    throw new Error('Les montants ne peuvent pas être négatifs.');
  if (charges === 0 && epargnePrecaution === 0) return { score: 0, message: null };

  // 1. Ratio de précaution
  const ratioPrecaution = charges > 0 ? epargnePrecaution / charges : Infinity;
  const tranche = SEUILS_PRECAUTION.find(s => ratioPrecaution >= s.min && ratioPrecaution < s.max);
  const base = tranche ? tranche.base : 20;

  // 2. Taux d'épargne
  const tauxEpargne = revenus > 0 ? (revenus - charges) / revenus : -1;
  const bonusTranche = BONUS_TAUX_EPARGNE.find(s => tauxEpargne >= s.min && tauxEpargne < s.max);
  const bonus = bonusTranche ? bonusTranche.bonus : 0;

  const score = Math.min(100, Math.max(0, base + bonus));

  // Message informatif (constat factuel, jamais une prescription)
  let message = null;
  if (charges > 0 && ratioPrecaution > SEUIL_PRECAUTION_EXCES_MOIS) {
    message = `Ton épargne de précaution couvre plus de ${Math.floor(ratioPrecaution)} mois de charges. `
            + `Au-delà de ${SEUIL_PRECAUTION_EXCES_MOIS} mois, une partie de cette épargne pourrait `
            + `potentiellement être allouée à d'autres usages selon tes objectifs déclarés.`;
  }

  return { score, message };
}


// ─── INTERPRÉTATION DES SCORES ────────────────────────────────────────────────

const NIVEAUX_TOLERANCE = [
  { min: 0,  max: 33,  label: 'Prudente',  desc: 'Tu es sensible aux pertes temporaires et préfères la sécurité à la performance.' },
  { min: 34, max: 66,  label: 'Modérée',   desc: 'Tu peux supporter des fluctuations limitées sur des horizons moyens.' },
  { min: 67, max: 100, label: 'Élevée',    desc: 'Les baisses à court terme ne t\'affectent pas — tu penses long terme.' },
];

const NIVEAUX_CAPACITE = [
  { min: 0,  max: 33,  label: 'Limitée',  desc: 'Ta marge de sécurité est faible. Consolider le coussin de précaution en priorité.' },
  { min: 34, max: 66,  label: 'Correcte', desc: 'Tu as un coussin de sécurité raisonnable et une marge d\'épargne.' },
  { min: 67, max: 100, label: 'Solide',   desc: 'Ta situation financière te permet d\'investir sereinement sur le long terme.' },
];

function niveauTolerance(score) {
  return NIVEAUX_TOLERANCE.find(n => score >= n.min && score <= n.max) || NIVEAUX_TOLERANCE[0];
}

function niveauCapacite(score) {
  return NIVEAUX_CAPACITE.find(n => score >= n.min && score <= n.max) || NIVEAUX_CAPACITE[0];
}


// Export pour tests Node.js
if (typeof module !== 'undefined') {
  module.exports = {
    QUESTIONS_TOLERANCE,
    SEUILS_PRECAUTION,
    BONUS_TAUX_EPARGNE,
    SEUIL_PRECAUTION_EXCES_MOIS,
    calcToleranceScore,
    calcCapaciteScore,
    niveauTolerance,
    niveauCapacite,
  };
}
