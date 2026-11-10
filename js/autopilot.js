// 自動ドッキング制御（デモ表示と、各ミッションがクリア可能かの検証に使う）
// プレイヤーと同じスラスタ性能・同じ操作入力（ポート基準）だけで飛ぶ。
import * as THREE from '../vendor/three.module.min.js';
import { LIN_ACC, quatAligning } from './sim.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Autopilot {
  constructor() {
    this.phase = 'approach';
    this.mode = 'transit'; // 転がるステーション用: transit → hold → dock（間に合わなければ retreat → hold）
  }

  // 目標の姿勢 qT と、目標の角速度（フィードフォワード）へ向ける操作量
  attitude(sim, ctl, qT, wFF) {
    const ax = sim.controlAxes(false);
    const R = ax.R.clone().applyQuaternion(sim.q);
    const U = ax.U.clone().applyQuaternion(sim.q);
    const F = ax.F.clone().applyQuaternion(sim.q);
    const qe = qT.clone().multiply(sim.q.clone().invert());
    if (qe.w < 0) { qe.x *= -1; qe.y *= -1; qe.z *= -1; qe.w *= -1; }
    const s = Math.sqrt(Math.max(1e-12, 1 - qe.w * qe.w));
    const angle = 2 * Math.acos(clamp(qe.w, -1, 1));
    const err = new THREE.Vector3(qe.x / s, qe.y / s, qe.z / s).multiplyScalar(angle);
    if (angle < 1e-6) err.set(0, 0, 0);
    const wDes = wFF.clone().add(err.multiplyScalar(0.9).clampLength(0, 0.35));
    const angAcc = wDes.sub(sim.w).multiplyScalar(3.0);
    ctl.rx = clamp(angAcc.dot(R) / ax.aR, -1, 1);
    ctl.ry = clamp(-angAcc.dot(U) / ax.aU, -1, 1);
    ctl.rz = clamp(angAcc.dot(F) / ax.aF, -1, 1);
  }

  // 目標の速度へ合わせる並進の操作量
  translate(sim, ctl, vDes) {
    const ax = sim.controlAxes(false);
    const acc = vDes.clone().sub(sim.vel).multiplyScalar(1.2);
    ctl.tx = clamp(acc.dot(ax.R.clone().applyQuaternion(sim.q)) / LIN_ACC, -1, 1);
    ctl.ty = clamp(acc.dot(ax.U.clone().applyQuaternion(sim.q)) / LIN_ACC, -1, 1);
    ctl.tz = clamp(acc.dot(ax.F.clone().applyQuaternion(sim.q)) / LIN_ACC, -1, 1);
  }

  // 転がるステーション: 安全な待機点（ステーションの回転半径より外、角運動量の方向）で窓を待つ
  updateTumble(sim, tm, ctl) {
    const HOLD = 55; // ステーション中心からの距離 [m]（リングが掃く半径 約46m より外）
    const L = sim.L0.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), sim.orbitN * sim.t);
    const H = L.clone().multiplyScalar(HOLD);
    const toH = H.clone().sub(sim.pos);
    const dH = toH.length();
    const win = tm.window;
    // ここから結合までにかかる時間の見積もり（遠い区間は速く、最後の10mはゆっくり）
    const finishTime = (axial) => Math.max(0, axial - 10) / 2.0 + Math.min(Math.max(axial, 0), 10) / 0.24 + 6;

    if (this.mode === 'transit' && dH < 8) this.mode = 'hold';
    if (this.mode === 'retreat' && dH < 8) this.mode = 'hold';
    if (this.mode === 'hold' && win.open && win.remaining > finishTime(tm.axial) + 15) { this.mode = 'dock'; this.phase = 'approach'; }
    if (this.mode === 'dock' && tm.axial > 2 && (!win.open || win.remaining < finishTime(tm.axial))) this.mode = 'retreat';
    if (this.mode === 'dock') return null; // 通常のドッキング操作へ

    // 待機・移動: ポートをステーション中心へ向け、回転は止める
    const toC = sim.pos.clone().negate().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    this.attitude(sim, ctl, quatAligning(sim.dock.F, sim.dock.U, toC, Math.abs(toC.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up), new THREE.Vector3());
    const vmax = this.mode === 'transit' ? 6 : 2;
    const vDes = dH > 0.01 ? toH.normalize().multiplyScalar(Math.min(vmax, 0.08 * dH)) : new THREE.Vector3();
    // 退避中はまずステーション中心から離れる向きの速度を確保する
    if (this.mode === 'retreat' && tm.centerDist < HOLD - 3) vDes.add(sim.pos.clone().normalize().multiplyScalar(1.0));
    this.translate(sim, ctl, vDes);
    return ctl;
  }

  // 訓練編の目標点: 目標点へ向かって止まる（姿勢はSASで保持）
  updateGoal(sim, ctl) {
    const d = sim.goalPos().sub(sim.pos);
    const dist = d.length();
    const vDes = dist > 0.01 ? d.multiplyScalar(Math.min(1.0, 0.02 * dist) / dist) : new THREE.Vector3();
    this.translate(sim, ctl, vDes);
    ctl.sas = true;
    return ctl;
  }

  update(sim) {
    const tm = sim.telemetry();
    const { a, vP } = tm;
    const tol = sim.sc.tol;
    const ctl = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, fine: false, sas: false, killRel: false };
    if (sim.status !== 'flying') return ctl;
    if (sim.sc.goal) return this.updateGoal(sim, ctl);
    if (sim.track) {
      const r = this.updateTumble(sim, tm, ctl);
      if (r) return r;
    }

    // 操作軸（ポート基準）をワールド座標に
    const ax = sim.controlAxes(false);
    const R = ax.R.clone().applyQuaternion(sim.q);
    const U = ax.U.clone().applyQuaternion(sim.q);
    const F = ax.F.clone().applyQuaternion(sim.q);

    // ---- 姿勢: ポートの向き = -軸、画面上方向 = ステーションのマーカー方向 ----
    const m = sim.markerDir(sim.t);
    const uT = m.addScaledVector(a, -m.dot(a)).normalize();
    const qT = quatAligning(sim.dock.F, sim.dock.U, a.clone().negate(), uT);
    const qe = qT.clone().multiply(sim.q.clone().invert());
    if (qe.w < 0) { qe.x *= -1; qe.y *= -1; qe.z *= -1; qe.w *= -1; }
    const s = Math.sqrt(Math.max(1e-12, 1 - qe.w * qe.w));
    const angle = 2 * Math.acos(clamp(qe.w, -1, 1));
    const err = new THREE.Vector3(qe.x / s, qe.y / s, qe.z / s).multiplyScalar(angle);
    if (angle < 1e-6) err.set(0, 0, 0);

    const wDes = sim.stationAngVel(sim.t).add(err.multiplyScalar(0.9).clampLength(0, 0.35));
    const angAcc = wDes.sub(sim.w).multiplyScalar(3.0);
    ctl.rx = clamp(angAcc.dot(R) / ax.aR, -1, 1);
    ctl.ry = clamp(-angAcc.dot(U) / ax.aU, -1, 1);
    ctl.rz = clamp(angAcc.dot(F) / ax.aF, -1, 1);

    // ---- 並進 ----
    const ready =
      tm.align < tol.align * 0.4 &&
      Math.abs(tm.dSpinRpm) < tol.spin * 0.4 &&
      Math.abs(tm.phase) < tol.phase * 0.4 &&
      tm.rateDeg < tol.rate * 0.5 &&
      tm.lateral < tol.lateral * 0.4;
    const standoff = sim.track ? 8 : 15; // 転がるステーションは窓の時間内に終えるため近めで同期
    let vAx; // 軸方向の目標速度（+ で離れる）
    if (tm.axial > standoff + 2) {
      vAx = -clamp(0.08 * (tm.axial - standoff), 0.2, 3.0);
      this.phase = 'approach';
    } else if (ready || (this.phase === 'final' && tm.lateral < tol.lateral * 0.7)) {
      vAx = -clamp(0.05 * tm.axial + 0.12, 0.12, 0.5);
      vAx = Math.max(vAx, -tol.closing * 0.6);
      this.phase = 'final';
    } else {
      vAx = -clamp(0.3 * (tm.axial - standoff), -1, 1);
      this.phase = 'sync';
    }
    // 回転を合わせていない状態で近づきすぎない
    if (this.phase !== 'final' && tm.axial < 6) vAx = Math.max(vAx, 0.2);

    const vLat = tm.latVec.clone().multiplyScalar(-0.6).clampLength(0, 1.0);
    const vDes = vP.clone().add(vLat).addScaledVector(a, vAx);
    const acc = vDes.sub(sim.vel).multiplyScalar(1.2);
    ctl.tx = clamp(acc.dot(R) / LIN_ACC, -1, 1);
    ctl.ty = clamp(acc.dot(U) / LIN_ACC, -1, 1);
    ctl.tz = clamp(acc.dot(F) / LIN_ACC, -1, 1);
    return ctl;
  }
}
