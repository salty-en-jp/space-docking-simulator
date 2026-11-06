// 自動ドッキング制御（デモ表示と、各ミッションがクリア可能かの検証に使う）
// プレイヤーと同じスラスタ性能・同じ操作入力（ポート基準）だけで飛ぶ。
import * as THREE from '../vendor/three.module.min.js';
import { LIN_ACC, quatAligning } from './sim.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Autopilot {
  constructor() {
    this.phase = 'approach';
  }

  update(sim) {
    const tm = sim.telemetry();
    const { a, vP } = tm;
    const tol = sim.sc.tol;
    const ctl = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, fine: false, sas: false, killRel: false };
    if (sim.status !== 'flying') return ctl;

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

    const wDes = a.clone().multiplyScalar(sim.omega).add(err.multiplyScalar(0.9).clampLength(0, 0.35));
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
    const standoff = 15;
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
