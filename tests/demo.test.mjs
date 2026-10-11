globalThis.performance ??= { now: () => Date.now() };
const { CrashDetector } = await import('../public/detector.js');
const G = 9.80665, DT = 1000 / 60;
function run(label, gen) {
  const out = { crash: null, near: 0 };
  const d = new CrashDetector({ demo: true, replay: true, onCrash: (i) => { out.crash = i; }, onNearMiss: () => out.near++ });
  let t = 0; for (const [lin, grav, rot] of gen()) { d.ingest(t, lin, grav, rot); t += DT; }
  if (d.pending) d.evaluate();
  console.log(label.padEnd(40), out.crash ? `crash (${out.crash.confidence})` : out.near ? 'near miss' : 'nothing');
}
const still = (n, g = [0, G, 0]) => Array.from({ length: n }, () => [[0.05, 0.05, 0.05], g, 2]);
run('hard shake, then set down (demo)', function* () {
  yield* still(60);
  for (let i = 0; i < 40; i++) { const a = 4.5 * G * Math.sin(i / 60 * 2 * Math.PI * 6); yield [[a, a * 0.4, 0.3 * G], [0, G, 0], 400]; }
  yield* still(150, [0, 0, G]);
});
run('medium shake only (demo)', function* () {
  yield* still(60);
  for (let i = 0; i < 25; i++) yield [[1.6 * G, 0.2, 0.2], [0, G, 0], 120];
  yield* still(150);
});
