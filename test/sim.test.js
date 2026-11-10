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
  while (sim.status === 'flying' && sim.t < (sc.group === 'training' ? 4000 : sc.tumble ? 2500 : 900)) {
    sim.step(DT, ap.update(sim));
    for (const e of sim.events.splice(0)) if (e.type === 'bump') { bumps++; console.log('  bump:', e.reasons.join(', ')); }
  }
  const ok = sim.status === 'docked' || sim.status === 'cleared';
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

// ---- 転がるステーション（オイラー方程式） ----
{
  const s = new Sim(SCENARIOS.tumble);
  const i0 = s.track.invariants(0), i1 = s.track.invariants(1500);
  check('tumble: energy and |L| conserved', Math.abs(i1.energy / i0.energy - 1) < 1e-9 && Math.abs(i1.L / i0.L - 1) < 1e-9,
    `dE=${(i1.energy / i0.energy - 1).toExponential(1)} dL=${(i1.L / i0.L - 1).toExponential(1)}`);
  s.scanWindows(1500);
  const lens = s.windows.slice(1, -1).map(([a, b]) => b - a);
  // 最初の窓は時刻0の途中から始まるので、間隔の比較は2つ目以降で
  const gaps = s.windows.slice(2).map(([a], i) => a - s.windows[i + 1][0]);
  check('tumble: port flips and faces back periodically (Dzhanibekov)', s.windows.length >= 5 && Math.min(...lens) > 80 && Math.max(...gaps) - Math.min(...gaps) < 2,
    `windows=${s.windows.length} length≈${lens[0]?.toFixed(0)}s cycle≈${gaps[0]?.toFixed(0)}s`);
}

// ---- 軌道力学（CW方程式） ----
{
  // 噴射なしの漂流が、CW方程式の解析解と一致する（x: 地球と反対向き = Y, y: 進行方向 = -Z）
  const s = new Sim(SCENARIOS.tumble);
  const n = s.orbitN;
  const x0 = s.pos.y, y0 = -s.pos.z, xd0 = s.vel.y, yd0 = -s.vel.z;
  const T = 600;
  for (let i = 0; i < T * 120; i++) s.step(1 / 120, idle({ sas: false }));
  const nt = n * s.t, c = Math.cos(nt), sn = Math.sin(nt);
  const xa = (4 - 3 * c) * x0 + (sn / n) * xd0 + (2 / n) * (1 - c) * yd0;
  const ya = 6 * (sn - nt) * x0 + y0 - (2 / n) * (1 - c) * xd0 + ((4 * sn - 3 * nt) / n) * yd0;
  const err = Math.hypot(s.pos.y - xa, -s.pos.z - ya);
  check('orbital: free drift matches analytic CW solution', err < 0.5, `after ${T}s: drift=${Math.hypot(s.pos.y - x0, -s.pos.z - y0).toFixed(1)} m, error=${err.toFixed(3)} m`);

  // 前（進行方向）へ噴射すると、上がって、やがて後ろへ下がる
  const b = new Sim(SCENARIOS.tumble);
  b.pos.set(0, 0, 1500); b.vel.set(0, 0, 0);
  b.vel.z -= 0.5; // 進行方向へ 0.5 m/s
  const z0 = b.pos.z;
  let maxUp = 0;
  for (let i = 0; i < 2000 * 120; i++) { b.step(1 / 120, idle({ sas: false })); maxUp = Math.max(maxUp, b.pos.y); }
  check('orbital: prograde burn rises and ends up behind', maxUp > 100 && b.pos.z > z0,
    `max rise ${maxUp.toFixed(0)} m, along-track change ${(z0 - b.pos.z).toFixed(0)} m (negative = fell behind)`);
}

// ---- 訓練編: 何もしなければクリアにならない／目標点の条件 ----
for (const id of ['tut1', 'tut2', 'tut3']) {
  const s = new Sim(SCENARIOS[id]);
  for (let i = 0; i < 120 * 60; i++) s.step(1 / 120, idle({ sas: false }));
  check(`${id}: not cleared by doing nothing`, s.status === 'flying', `status=${s.status} goalDist=${s.goalDist().toFixed(0)} m`);
}
{
  // T2: V-bar から20m上の軌道にいると、噴射しなくても後ろへ流される（教える内容そのもの）
  const s = new Sim(SCENARIOS.tut2);
  const z0 = s.pos.z, y0 = s.pos.y;
  for (let i = 0; i < 120 * 400; i++) s.step(1 / 120, idle({ sas: false }));
  check('tut2: offset above V-bar drifts backward at constant height', s.pos.z - z0 > 12 && Math.abs(s.pos.y - y0) < 0.5,
    `drift ${(s.pos.z - z0).toFixed(1)} m in 400 s, height change ${(s.pos.y - y0).toFixed(2)} m`);
  // 手順が順に進む
  const t = new Sim(SCENARIOS.tut1);
  const tm = () => t.telemetry();
  const seq = [t.updateTutorial(tm()).index];
  t.vel.z -= 0.05; seq.push(t.updateTutorial(tm()).index);
  t.vel.set(0, 0, 0); seq.push(t.updateTutorial(tm()).index);
  t.vel.y -= 0.05; seq.push(t.updateTutorial(tm()).index);
  // T1: 下へ（地球側へ）ちょうど Δy·n/4 だけ押すと、半周回後に目標点の近くへ着く（R-bar ホップ）
  const h = new Sim(SCENARIOS.tut1);
  const dy = h.pos.z - h.goalPos().z;
  h.vel.y -= (dy * h.orbitN) / 4;
  const half = Math.PI / h.orbitN;
  // 目標点に着くとクリアになり時間が止まるので、status も見てループを抜ける
  let minMiss = Infinity;
  while (h.t < half && h.status === 'flying') { h.step(1 / 120, idle({ sas: false })); minMiss = Math.min(minMiss, h.goalDist()); }
  check('tut1: a downward hop of Δv = Δy·n/4 reaches the goal in about half an orbit', h.status === 'cleared' || minMiss < 20,
    `Δv=${((dy * h.orbitN) / 4).toFixed(3)} m/s, half orbit=${half.toFixed(0)} s, arrived at t=${h.t.toFixed(0)} s, status=${h.status}`);
  check('tut1: steps advance in order', seq.join(',') === '0,1,2,3', `steps=${seq.join(',')}`);
}
process.exit(failed ? 1 : 0);
