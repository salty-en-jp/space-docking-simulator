// オートパイロットで全ミッションがクリア可能かを確認するヘッドレステスト
import { Sim, SCENARIOS, RPM } from '../js/sim.js';
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

// ---- 回転ロックのテスト ----
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!cond) failed++; };
const idle = (extra = {}) => ({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sas: true, ...extra });
for (const id of ['advanced', 'extreme']) {
  // 回転差 2 rpm から、ロールに触らずロックだけで同期し、30秒保てること（軸のぶれ込み）
  const s = new Sim(SCENARIOS[id]);
  s.w.copy(s.axis(0)).multiplyScalar(s.omega - 2 * RPM);
  for (let i = 0; i < 120 * 3; i++) s.step(1 / 120, idle({ spinLock: true }));
  const d3 = Math.abs(s.telemetry().dSpinRpm);
  let worst = 0;
  for (let i = 0; i < 120 * 30; i++) { s.step(1 / 120, idle({ spinLock: true })); worst = Math.max(worst, Math.abs(s.telemetry().dSpinRpm)); }
  check(`spin lock holds (${id})`, d3 < 0.1 && worst < SCENARIOS[id].tol.spin * 0.5 && s.usedAssist,
    `after 3s ${d3.toFixed(3)} rpm, worst over 30s ${worst.toFixed(3)} rpm`);
  // 回転差が大きいときは作動しない（待機）
  const f = new Sim(SCENARIOS[id]);
  f.step(1 / 120, idle({ spinLock: true }));
  check(`spin lock waits when far (${id})`, f.spinLockState === 'armed' && !f.usedAssist, `state=${f.spinLockState}`);
  // ロール入力中は手動優先
  const m = new Sim(SCENARIOS[id]);
  m.w.copy(m.axis(0)).multiplyScalar(m.omega);
  m.step(1 / 120, idle({ spinLock: true, rz: -1 }));
  check(`manual roll overrides lock (${id})`, m.spinLockState === 'manual', `state=${m.spinLockState}`);
}
process.exit(failed ? 1 : 0);
