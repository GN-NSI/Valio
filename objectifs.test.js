// Tests unitaires du moteur de projection — node objectifs.test.js
const {
  getMuSigma, scoreToSri, epargneForAnnee,
  simulateProjection, simulateTrajectory,
  findEpargneMensuelle, findHorizon,
  ANCHOR_MIN, ANCHOR_MAX,
} = require('./objectifs.js');

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

// ── getMuSigma ──────────────────────────────────────────────────────────────
console.log('\n── getMuSigma ──\n');

const ms0   = getMuSigma(0,   true);
const ms100 = getMuSigma(100, true);
const ms50  = getMuSigma(50,  true);

assert('score 0 → mu = ANCHOR_MIN.mu',       Math.abs(ms0.mu    - ANCHOR_MIN.mu)    < 1e-9);
assert('score 0 → sigma = ANCHOR_MIN.sigma', Math.abs(ms0.sigma - ANCHOR_MIN.sigma) < 1e-9);
assert('score 100 → mu = ANCHOR_MAX.mu',     Math.abs(ms100.mu  - ANCHOR_MAX.mu)    < 1e-9);
assert('score 100 → sigma = ANCHOR_MAX.sigma', Math.abs(ms100.sigma - ANCHOR_MAX.sigma) < 1e-9);
assert('score 50 → mu interpolé',    Math.abs(ms50.mu    - (ANCHOR_MIN.mu    + ANCHOR_MAX.mu)    / 2) < 1e-9);
assert('score 50 → sigma interpolé', Math.abs(ms50.sigma - (ANCHOR_MIN.sigma + ANCHOR_MAX.sigma) / 2) < 1e-9);
assert('nominal → mu > réel',        getMuSigma(50, false).mu > ms50.mu);

// ── scoreToSri ──────────────────────────────────────────────────────────────
console.log('\n── scoreToSri ──\n');

assert('score 0   → SRI 1', scoreToSri(0)   === 1);
assert('score 100 → SRI 7', scoreToSri(100) === 7);
assert('SRI toujours 1-7',  [0,17,33,50,66,83,100].every(s => scoreToSri(s) >= 1 && scoreToSri(s) <= 7));

// ── epargneForAnnee ─────────────────────────────────────────────────────────
console.log('\n── epargneForAnnee ──\n');

const pS = [{ annee_debut: 0, montant_mensuel: 500 }];
const pM = [
  { annee_debut: 0,  montant_mensuel: 300  },
  { annee_debut: 5,  montant_mensuel: 600  },
  { annee_debut: 10, montant_mensuel: 1000 },
];

assert('palier unique année 0',   epargneForAnnee(pS, 0)  === 500);
assert('palier unique année 20',  epargneForAnnee(pS, 20) === 500);
assert('multi-palier année 0',    epargneForAnnee(pM, 0)  === 300);
assert('multi-palier année 4',    epargneForAnnee(pM, 4)  === 300);
assert('multi-palier année 5',    epargneForAnnee(pM, 5)  === 600);
assert('multi-palier année 9',    epargneForAnnee(pM, 9)  === 600);
assert('multi-palier année 10',   epargneForAnnee(pM, 10) === 1000);
assert('multi-palier année 30',   epargneForAnnee(pM, 30) === 1000);

// ── simulateTrajectory ──────────────────────────────────────────────────────
console.log('\n── simulateTrajectory ──\n');

const p0   = [{ annee_debut: 0, montant_mensuel: 0   }];
const p500 = [{ annee_debut: 0, montant_mensuel: 500 }];

const traj = simulateTrajectory(10000, p500, 10, 50);
assert('longueur trajectoire = horizonAnnees + 1', traj.length === 11);
assert('année 0 = capital initial', Math.abs(traj[0].p50 - 10000) < 1);
assert('P5 < P50 < P95 chaque année', traj.every(t => t.p5 < t.p50 && t.p50 < t.p95));
assert('P50 final > capital initial', traj[10].p50 > 10000);

// 2e palier élevé → capital final plus grand
const trajBas  = simulateTrajectory(10000, [{ annee_debut:0, montant_mensuel:200 }, { annee_debut:5, montant_mensuel:200  }], 10, 50, true);
const trajHaut = simulateTrajectory(10000, [{ annee_debut:0, montant_mensuel:200 }, { annee_debut:5, montant_mensuel:1000 }], 10, 50, true);
assert('2e palier élevé → P50 final plus grand', trajHaut[10].p50 > trajBas[10].p50);

// Score plus élevé → dispersion plus grande
const trajP = simulateTrajectory(10000, p500, 20, 10,  true);
const trajD = simulateTrajectory(10000, p500, 20, 90,  true);
assert('score 90 → spread P5-P95 plus large que score 10', (trajD[20].p95 - trajD[20].p5) > (trajP[20].p95 - trajP[20].p5));

// Horizon long → médiane plus haute
const trajC = simulateTrajectory(0, p500, 10, 50, true);
const trajL = simulateTrajectory(0, p500, 20, 50, true);
assert('horizon 20 ans → P50 > horizon 10 ans', trajL[20].p50 > trajC[10].p50);

// Nominal > réel
assert('nominal P50 > réel P50',
  simulateTrajectory(10000, p500, 10, 50, false)[10].p50 >
  simulateTrajectory(10000, p500, 10, 50, true )[10].p50);

// Capital 0, épargne 0 → résultat nul
assert('capital 0 + épargne 0 → P50 ≈ 0', Math.abs(simulateTrajectory(0, p0, 5, 50)[5].p50) < 1);

// ── findEpargneMensuelle ────────────────────────────────────────────────────
console.log('\n── findEpargneMensuelle ──\n');

assert('retourne > 0', findEpargneMensuelle(0, 50000, 10, 50, true) > 0);
assert('capital suffisant → 0', findEpargneMensuelle(1000000, 50000, 10, 50, true) === 0);
assert('horizon long → épargne plus faible',
  findEpargneMensuelle(0, 100000, 20, 50, true) < findEpargneMensuelle(0, 100000, 10, 50, true));

// ── findHorizon ─────────────────────────────────────────────────────────────
console.log('\n── findHorizon ──\n');

const h500  = findHorizon(0, [{ annee_debut:0, montant_mensuel:500  }], 100000, 50, true);
const h1000 = findHorizon(0, [{ annee_debut:0, montant_mensuel:1000 }], 100000, 50, true);
assert('retourne entier positif', Number.isInteger(h500) && h500 > 0);
assert('épargne plus élevée → horizon plus court', h1000 < h500);
assert('cible inatteignable → null', findHorizon(0, p0, 1000000, 0, true) === null);

console.log(`\n${passed + failed} tests — ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
