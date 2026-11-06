// オートパイロットで全ミッションがクリア可能かを確認するヘッドレステスト
import * as THREE from '../vendor/three.module.min.js';
import { Sim, SCENARIOS, RPM, DEG } from '../js/sim.js';
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

// ---- 救済ボタン ----
for (const id of ['extreme', 'dorsalx']) {
  // 回転停止: でたらめに回っている船が止まる
  const s = new Sim(SCENARIOS[id]);
  s.w.set(0.4, -0.3, 2.5);
  let t = 0;
  while (s.w.length() > 0.005 && t < 20) { s.step(1 / 120, idle({ rotStop: true })); t += 1 / 120; }
  check(`rotation stop (${id})`, s.w.length() <= 0.005 && !s.usedAssist, `stopped in ${t.toFixed(1)}s, |w|=${s.w.length().toFixed(4)}`);

  // 姿勢復帰: 回転を合わせたまま 20° ずれた向きを、回転を保ったまま軸に戻す
  const r = new Sim(SCENARIOS[id]);
  const a = r.axis(0);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 20 * DEG);
  r.q.premultiply(tilt);
  r.w.copy(a).multiplyScalar(r.omega);
  const before = r.telemetry().align;
  let worstSpin = 0;
  for (let i = 0; i < 120 * 20; i++) { r.step(1 / 120, idle({ realign: true })); worstSpin = Math.max(worstSpin, Math.abs(r.telemetry().dSpinRpm)); }
  const after = r.telemetry();
  check(`realign (${id})`, after.align < 1 && after.rateDeg < 1 && r.usedAssist,
    `align ${before.toFixed(1)}° -> ${after.align.toFixed(2)}°, spin kept within ${worstSpin.toFixed(2)} rpm, rate ${after.rateDeg.toFixed(2)}°/s`);
}

// ---- 上部ポート: 操作基準 ----
{
  const s = new Sim(SCENARIOS.dorsal);
  const f = s.dockDir(), nose = new THREE.Vector3(0, 0, 1).applyQuaternion(s.q);
  s.step(1 / 120, idle({ tz: 1 }));
  const accPort = s.accBody.clone().applyQuaternion(s.q).normalize();
  const s2 = new Sim(SCENARIOS.dorsal);
  s2.step(1 / 120, idle({ tz: 1, bodyFrame: true }));
  const accBody = s2.accBody.clone().applyQuaternion(s2.q).normalize();
  check('top port: W moves toward port in port frame', accPort.dot(f) > 0.99, `dot=${accPort.dot(f).toFixed(3)}`);
  check('top port: W moves toward nose in body frame', accBody.dot(nose) > 0.99, `dot=${accBody.dot(nose).toFixed(3)}`);
  // ポート基準の Q はステーションと同じ向きへ回す
  const s3 = new Sim(SCENARIOS.dorsal);
  s3.step(1 / 120, idle({ rz: -1 }));
  check('top port: Q spins with station', s3.w.dot(s3.axis(s3.t)) > 0.002, `w·a=${s3.w.dot(s3.axis(s3.t)).toFixed(4)}`);
  // 機体基準では → がステーションと同じ向き
  const s4 = new Sim(SCENARIOS.dorsal);
  s4.step(1 / 120, idle({ ry: 1, bodyFrame: true }));
  check('top port body frame: → spins with station', s4.w.dot(s4.axis(s4.t)) > 0.002 && s4.spinKeys(true)[0] === '→', `w·a=${s4.w.dot(s4.axis(s4.t)).toFixed(4)}`);
}
process.exit(failed ? 1 : 0);
