// 転がるステーション（トルクのない剛体の回転）
//
// オイラーの運動方程式:
//   I1 ω1' = (I2 - I3) ω2 ω3,  I2 ω2' = (I3 - I1) ω3 ω1,  I3 ω3' = (I1 - I2) ω1 ω2
// 慣性モーメントが「中間」の軸のまわりの回転は不安定で、周期的に軸ごと反転する（ジャニベコフ効果）。
// ドッキングポートの軸（機体座標の Z）をこの中間の軸にしてある。
//
// ステーションの動きは船の操作の影響を受けないので、時間の関数として前もって計算しておく
// （必要になった時刻まで、少しずつ延長しながら積分する）。
import * as THREE from '../vendor/three.module.min.js';

const DT = 0.01;          // 積分の刻み [s]
const SAMPLE_EVERY = 5;   // 記録する間隔（刻み5つ = 0.05 s）

function deriv(I, w, q) {
  const [I1, I2, I3] = I;
  const dw = [
    ((I2 - I3) * w[1] * w[2]) / I1,
    ((I3 - I1) * w[2] * w[0]) / I2,
    ((I1 - I2) * w[0] * w[1]) / I3,
  ];
  // q' = 1/2 q ⊗ (0, ω)   （ω は機体座標）
  const [x, y, z, s] = q;
  const dq = [
    0.5 * (s * w[0] + y * w[2] - z * w[1]),
    0.5 * (s * w[1] + z * w[0] - x * w[2]),
    0.5 * (s * w[2] + x * w[1] - y * w[0]),
    0.5 * (-x * w[0] - y * w[1] - z * w[2]),
  ];
  return [dw, dq];
}

const add = (a, b, k) => a.map((v, i) => v + b[i] * k);

export class TumbleTrack {
  // I: [Ix, Iy, Iz]（機体座標の主慣性モーメント）, w0: 初期角速度（機体座標）
  constructor(I, w0) {
    this.I = I;
    this.w = [...w0];
    this.q = [0, 0, 0, 1];
    this.t = 0;
    this.samples = [{ w: [...this.w], q: [...this.q] }];
    this.step = 0;
  }

  extendTo(t) {
    while (this.t < t + 1) {
      const { I } = this;
      const [k1w, k1q] = deriv(I, this.w, this.q);
      const [k2w, k2q] = deriv(I, add(this.w, k1w, DT / 2), add(this.q, k1q, DT / 2));
      const [k3w, k3q] = deriv(I, add(this.w, k2w, DT / 2), add(this.q, k2q, DT / 2));
      const [k4w, k4q] = deriv(I, add(this.w, k3w, DT), add(this.q, k3q, DT));
      this.w = this.w.map((v, i) => v + (DT / 6) * (k1w[i] + 2 * k2w[i] + 2 * k3w[i] + k4w[i]));
      this.q = this.q.map((v, i) => v + (DT / 6) * (k1q[i] + 2 * k2q[i] + 2 * k3q[i] + k4q[i]));
      const n = Math.hypot(...this.q);
      this.q = this.q.map((v) => v / n);
      this.t += DT;
      if (++this.step % SAMPLE_EVERY === 0) this.samples.push({ w: [...this.w], q: [...this.q] });
    }
  }

  // 時刻 t の姿勢（慣性空間）と角速度（機体座標）
  sample(t) {
    t = Math.max(0, t);
    this.extendTo(t);
    const h = DT * SAMPLE_EVERY;
    const i = Math.min(Math.floor(t / h), this.samples.length - 2);
    const f = t / h - i;
    const a = this.samples[i], b = this.samples[i + 1];
    const qa = new THREE.Quaternion(...a.q), qb = new THREE.Quaternion(...b.q);
    const q = qa.slerp(qb, f);
    const w = new THREE.Vector3(...a.w.map((v, k) => v + (b.w[k] - v) * f));
    return { q, w };
  }

  // 保存量（テスト用）: 回転のエネルギーと角運動量の大きさ
  invariants(t) {
    const { w } = this.sample(t);
    const L = [this.I[0] * w.x, this.I[1] * w.y, this.I[2] * w.z];
    return { energy: 0.5 * (L[0] * w.x + L[1] * w.y + L[2] * w.z), L: Math.hypot(...L) };
  }
}
