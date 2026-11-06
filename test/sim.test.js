// オートパイロットで全ミッションがクリア可能かを確認するヘッドレステスト
import { Sim, SCENARIOS } from '../js/sim.js';
import { Autopilot } from '../js/autopilot.js';

const DT = 1 / 120;
let failed = 0;
for (const sc of Object.values(SCENARIOS)) {
  const sim = new Sim(sc);
  const ap = new Autopilot();
  let bumps = 0;
  while (sim.status === 'flying' && sim.t < 900) {
    sim.step(DT, ap.update(sim));
    for (const e of sim.events.splice(0)) if (e.type === 'bump') { bumps++; console.log('  bump:', e.reasons.join(', ')); }
  }
  const ok = sim.status === 'docked';
  if (!ok) failed++;
  const r = sim.result;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${sc.id}: status=${sim.status} t=${sim.t.toFixed(1)}s fuel=${(sim.fuel / sim.fuelMax * 100).toFixed(0)}% bumps=${bumps}` +
    (r ? ` score=${r.score} rank=${r.rank}` : ` reason=${sim.reason}`));
  if (sim.lastContact) console.log('  contact:', sim.lastContact.checks.map((c) => `${c.key}=${c.value.toFixed(3)}/${c.limit}`).join(' '));
}
process.exit(failed ? 1 : 0);
