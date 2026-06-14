// Tests unitaires du moteur de projection — exécuter avec : node objectifs.test.js
const { simulateProjection } = require('./objectifs.js');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log('\n── Moteur de projection Monte-Carlo ──\n');

// 1. P5 < P50 < P95 pour chaque profil
for (const profil of ['prudent', 'equilibre', 'dynamique']) {
  const r = simulateProjection(10000, 300, 20, profil);
  assert(`${profil} : P5 < P50`, r.p5 < r.p50);
  assert(`${profil} : P50 < P95`, r.p50 < r.p95);
  assert(`${profil} : P5 > 0`, r.p5 > 0);
}

// 2. Épargne plus élevée → médiane plus haute (même profil, même horizon)
{
  const faible = simulateProjection(10000, 100, 20, 'equilibre');
  const forte  = simulateProjection(10000, 500, 20, 'equilibre');
  assert('Épargne plus haute → P50 plus haut', forte.p50 > faible.p50);
}

// 3. Horizon plus long → médiane plus haute (avec rendement positif)
{
  const court = simulateProjection(10000, 200, 10, 'equilibre');
  const long  = simulateProjection(10000, 200, 30, 'equilibre');
  assert('Horizon plus long → P50 plus haut', long.p50 > court.p50);
}

// 4. Mode nominal donne des valeurs plus hautes que mode réel (inflation ajoutée)
{
  const reel    = simulateProjection(10000, 200, 20, 'equilibre', true);
  const nominal = simulateProjection(10000, 200, 20, 'equilibre', false);
  assert('Nominal > réel sur P50 (inflation +2%)', nominal.p50 > reel.p50);
}

// 5. Capital nul, épargne nulle → résultat nul
{
  const r = simulateProjection(0, 0, 10, 'prudent');
  assert('Capital=0 et épargne=0 → P50 ≈ 0', Math.abs(r.p50) < 1);
}

// 6. Profil dynamique doit avoir une P95 plus haute ET une P5 plus basse que prudent
{
  const prud = simulateProjection(10000, 300, 20, 'prudent');
  const dyn  = simulateProjection(10000, 300, 20, 'dynamique');
  assert('Dynamique P95 > Prudent P95 (plus de potentiel)', dyn.p95 > prud.p95);
  assert('Dynamique P5 < Prudent P5 (plus de risque)', dyn.p5 < prud.p5);
}

console.log(`\n${passed + failed} tests — ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
