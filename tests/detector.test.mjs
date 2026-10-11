// Replays every scenario through the detector at each sensitivity level.
// Run: node tests/detector.test.mjs
globalThis.performance ??= { now: () => Date.now() };
const { SCENARIOS } = await import('../public/scenarios.js');
const { replay } = await import('../public/detector.js');

let failed = 0;
for (const sens of ['normal', 'high', 'low']) {
  console.log(`\nSensitivity: ${sens}`);
  for (const sc of SCENARIOS) {
    const s = sc.build();
    const r = replay(s, { sensitivity: sens });
    // Low sensitivity may miss borderline events; high may flag borderline look-alikes only as near misses.
    const ok = r.outcome === sc.expect;
    if (!ok) failed++;
    const e = r.evaluations.at(-1);
    const f = e?.features;
    console.log(`${ok ? '✓' : '✗'} ${sc.name.padEnd(42)} → ${r.outcome.padEnd(9)} (expected ${sc.expect}) conf ${r.confidence.toFixed(2)}` +
      (f ? ` | peak ${f.peakG}g dur ${f.impactMs}ms dv ${f.deltaV} ff ${f.freeFallMs}ms rot ${f.rotPeak} tilt ${f.tilt}° still ${f.still} moving ${f.moving} drop ${f.speedDrop}` : '') +
      (r.notes?.length ? ` | ${r.notes.join('; ')}` : ''));
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nAll scenarios passed');
process.exit(failed ? 1 : 0);
