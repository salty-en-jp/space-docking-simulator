// ドッキング物理シミュレーション（描画に依存しない純粋なロジック）
import * as THREE from '../vendor/three.module.min.js';
import { TumbleTrack } from './tumble.js';

export const PORT_Z = 14;          // ステーション座標系でのドッキングポート面の位置
export const HUB_R = 4;            // 中央ハブの半径
export const HUB_BACK = -8;        // ハブ後端
export const PORT_CAPTURE_R = 3.0; // ポートが船を受け止められる半径
export const RING_R = 40;          // 居住リングの半径
export const NOSE = 3.2;           // 船の重心からドッキングカラーまでの距離

export const TOP_PORT_H = 1.15;    // 上部ポート: 重心からドッキングリング面までの高さ

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// 船のドッキングポートの種類（機体座標）。F: ポートの向き、U: 画面上で「上」とする向き（マーカーと合わせる側）
export const DOCK_TYPES = {
  nose: { name: '機首ポート', local: V3(0, 0, NOSE), F: V3(0, 0, 1), U: V3(0, 1, 0) },
  top: { name: '上部ポート', local: V3(0, TOP_PORT_H, 0), // 重心の真上（ずれていると回転中にポートが円を描く）
        F: V3(0, 1, 0), U: V3(0, 0, 1) },
};
// 機体基準の操作軸（従来の操作）: 右 = -X, 上 = +Y, 前 = +Z
const BODY_FRAME = { R: V3(-1, 0, 0), U: V3(0, 1, 0), F: V3(0, 0, 1) };

export const LIN_ACC = 0.5;        // 並進スラスタ加速度 [m/s^2]
export const PY_ACC = 0.35;        // ピッチ/ヨー角加速度 [rad/s^2]
export const ROLL_ACC = 1.0;       // ロール角加速度 [rad/s^2]
export const CRASH_SPEED = 1.5;    // これ以上の接近速度で接触すると大破
export const SPIN_LOCK_CAPTURE_RPM = 3; // 回転ロックが作動する回転差
export const ASSIST_SCORE_FACTOR = 0.9; // 回転ロック使用時のスコア倍率

export const RPM = (Math.PI * 2) / 60;
export const DEG = Math.PI / 180;

export const SCENARIOS = {
  training: {
    id: 'training',
    name: '訓練',
    title: 'MISSION 01 ／ 訓練飛行',
    briefing:
      '軌道上の訓練ステーション〈ハルシオン〉は毎分2回転でゆっくり自転しています。' +
      '軸線上に船を並べ、回転を合わせ、マーカーをそろえてから静かに接近してください。',
    spinRpm: 2,
    rollAcc: 0.15,
    wobbleDeg: 0,
    wobblePeriod: 60,
    timeLimit: 0,
    fuel: 140,
    start: { dist: 50, lateral: [3, -2], misalignDeg: 6, drift: [0.03, -0.02, -0.15] },
    tol: { closing: 0.5, lateral: 0.6, align: 5, spin: 1.0, phase: 15, rate: 2.0 },
  },
  standard: {
    id: 'standard',
    name: '標準',
    title: 'MISSION 02 ／ 補給ランデブー',
    briefing:
      '深宇宙中継ステーション〈ハルシオン〉は人工重力のため毎分8回転しています。' +
      '補給船〈ケストレル〉で回転に同期し、ハブ中央のポートへドッキングせよ。',
    spinRpm: 8,
    rollAcc: 0.4,
    wobbleDeg: 0,
    wobblePeriod: 60,
    timeLimit: 0,
    fuel: 100,
    start: { dist: 80, lateral: [5, 3], misalignDeg: 9, drift: [-0.05, 0.04, -0.3] },
    tol: { closing: 0.4, lateral: 0.45, align: 3.5, spin: 0.6, phase: 9, rate: 1.5 },
  },
  advanced: {
    id: 'advanced',
    name: '高速',
    title: 'MISSION 03 ／ 居住区画への帰還',
    briefing:
      '大型ステーション〈ハルシオン〉の居住区画は、地球と同じ重力を作るため毎分18回転している。軸は安定している。' +
      '回転差が3rpm以内になったら［回転ロック］（Lキー）で回転を保てる。',
    spinRpm: 18,
    rollAcc: 0.7,
    wobbleDeg: 0,
    wobblePeriod: 60,
    timeLimit: 0,
    fuel: 100,
    start: { dist: 85, lateral: [5, -4], misalignDeg: 9, drift: [0.05, 0.05, -0.35] },
    tol: { closing: 0.4, lateral: 0.45, align: 3.5, spin: 0.6, phase: 9, rate: 1.5 },
  },
  extreme: {
    id: 'extreme',
    name: '限界',
    title: 'MISSION 04 ／ 制御不能',
    briefing:
      '爆発事故でステーション〈ハルシオン〉は毎分36回転の高速回転に陥り、軸もぶれながら大気圏へ落ちつつある。' +
      '残り5分。回転に同期できなければ、誰も帰れない。（回転ロック使用可）',
    spinRpm: 36,
    rollAcc: 1.0,
    wobbleDeg: 1.0,
    wobblePeriod: 40,
    timeLimit: 300,
    fuel: 90,
    start: { dist: 90, lateral: [6, 4], misalignDeg: 10, drift: [0.06, -0.05, -0.4] },
    tol: { closing: 0.35, lateral: 0.4, align: 3, spin: 0.6, phase: 8, rate: 1.5 },
  },
  dorsal: {
    id: 'dorsal',
    name: '上部ポート',
    title: 'MISSION 05 ／ 上部ポート',
    briefing:
      '改修型〈ケストレル〉は、ドッキングポートが機体の上面にある。毎分6回転のステーションに、上面のポートを向けて結合せよ。' +
      '操作はポート基準（W でポートの方向へ進む）。V キーで機体基準に切り替えられる。',
    dock: 'top',
    spinRpm: 6,
    rollAcc: 0.3,
    wobbleDeg: 0,
    wobblePeriod: 60,
    timeLimit: 0,
    fuel: 110,
    start: { dist: 60, lateral: [4, -3], misalignDeg: 8, drift: [0.04, -0.03, -0.25] },
    tol: { closing: 0.4, lateral: 0.45, align: 3.5, spin: 0.6, phase: 9, rate: 1.5 },
  },
  tumble: {
    id: 'tumble',
    name: '転がる星',
    title: 'MISSION 07 ／ 転がる軌道ステーション',
    briefing:
      '制御を失った軌道ステーション〈ハルシオン〉は、毎分4回転しながら、数分ごとに軸ごとくるりと反転している（ジャニベコフ効果）。' +
      '1.5km後方から軌道力学に従って接近し、ポートがこちらを向いている「静かな時間」に結合せよ。前に噴射すると、上がって後ろへ下がるので注意。',
    spinRpm: 4,
    rollAcc: 0.5,
    wobbleDeg: 0,
    wobblePeriod: 60,
    timeLimit: 0,
    fuel: 150,
    farLimit: 5000,
    // 慣性モーメント [Ix, Iy, Iz]: ポートの軸 Z を中間にして、反転が起きるようにする
    tumble: { I: [1.0, 2.2, 1.6], perturb: 1e-4, windowDeg: 8 },
    // 高度約400kmの地球低軌道（周期 約92.6分）
    orbital: { n: 0.00113 },
    start: { dist: 1500, lateral: [0, 15], misalignDeg: 5, drift: [0, 0, 0] },
    tol: { closing: 0.4, lateral: 0.45, align: 3.5, spin: 0.6, phase: 9, rate: 1.5 },
  },
  dorsalx: {
    id: 'dorsalx',
    name: '母船',
    title: 'MISSION 06 ／ 母船への帰還',
    briefing:
      '損傷した母船〈ハルシオン〉は毎分30回転で回りながら、軸もぶれて大気圏へ落ちていく。' +
      '上面のポートで結合し、乗員を移せ。残り5分。',
    dock: 'top',
    spinRpm: 30,
    rollAcc: 0.9,
    wobbleDeg: 0.8,
    wobblePeriod: 45,
    timeLimit: 300,
    fuel: 90,
    start: { dist: 90, lateral: [-6, 4], misalignDeg: 12, drift: [-0.05, 0.05, -0.4] },
    tol: { closing: 0.35, lateral: 0.4, align: 3, spin: 0.6, phase: 8, rate: 1.5 },
  },
};

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function quatFromForwardUp(f, upHint) {
  const z = f.clone().normalize();
  const x = new THREE.Vector3().crossVectors(upHint, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// 機体ベクトル bF→wF、bU→（wUhint を wF に直交化した向き）へ移す回転
export function quatAligning(bF, bU, wF, wUhint) {
  const qb = quatFromForwardUp(bF, bU);
  const qw = quatFromForwardUp(wF, wUhint);
  return qw.multiply(qb.invert());
}

// a に垂直な単位ベクトル v の、a まわりの符号付き角度（from → to）
export function signedAngleAbout(from, to, a) {
  const f = from.clone().addScaledVector(a, -from.dot(a));
  const t = to.clone().addScaledVector(a, -to.dot(a));
  const cross = new THREE.Vector3().crossVectors(f, t);
  return Math.atan2(cross.dot(a), f.dot(t));
}

function clampLen(v, max) {
  const l = v.length();
  if (l > max) v.multiplyScalar(max / l);
  return v;
}

export class Sim {
  constructor(scenario) {
    this.sc = scenario;
    this.omega = scenario.spinRpm * RPM;
    this.dockType = scenario.dock || 'nose';
    this.dock = DOCK_TYPES[this.dockType];
    // 軌道力学（CW方程式）の平均運動 n [rad/s]。0 なら軌道力学なし
    this.orbitN = scenario.orbital ? scenario.orbital.n : 0;
    if (scenario.tumble) {
      const tb = scenario.tumble;
      this.track = new TumbleTrack(tb.I, [tb.perturb * this.omega, tb.perturb * this.omega * 0.5, this.omega]);
      const { w } = this.track.sample(0);
      this.L0 = new THREE.Vector3(tb.I[0] * w.x, tb.I[1] * w.y, tb.I[2] * w.z).normalize(); // 慣性空間で一定
      this.windows = []; // ポートが L0 方向を向いている時間帯 [開始, 終了]
      this.windowScanT = 0;
    }
    this.reset();
  }

  reset() {
    const s = this.sc.start;
    this.t = 0;
    this.status = 'flying'; // flying | docked | crashed | failed
    this.reason = '';
    this.hull = 1;
    this.fuelMax = this.sc.fuel;
    this.fuel = this.sc.fuel;
    this.events = [];
    this.result = null;
    this.lastContact = null;
    this.accBody = new THREE.Vector3();
    this.angBody = new THREE.Vector3();
    this.spinLockState = 'off'; // off | armed（待機） | engaged（作動中） | manual（手動ロール中）
    this.usedAssist = false;

    const a = this.axis(0);
    const P = this.portPos(0);
    const e1 = Y.clone().addScaledVector(a, -Y.dot(a)).normalize();
    const e2 = new THREE.Vector3().crossVectors(a, e1);
    this.pos = P.clone()
      .addScaledVector(a, s.dist + this.dock.local.dot(this.dock.F))
      .addScaledVector(e2, s.lateral[0])
      .addScaledVector(e1, s.lateral[1]);
    const f = a.clone().negate().applyAxisAngle(e1, s.misalignDeg * DEG);
    this.q = quatAligning(this.dock.F, this.dock.U, f, e1);
    this.vel = new THREE.Vector3(...s.drift);
    this.w = new THREE.Vector3(0.004, -0.006, 0.01);
    this.prevNoseZ = Infinity;
  }

  // ---- ステーションの姿勢 ----
  // 転がるステーション: 慣性空間の姿勢を、ステーションと一緒に回る座標系（LVLH）へ。
  // LVLH は慣性空間に対して軌道面の法線まわりに n で回るので、慣性空間で一定の向きは +X まわりに n で回って見える。
  tumbleQuat(t) {
    const { q } = this.track.sample(t);
    return new THREE.Quaternion().setFromAxisAngle(X, this.orbitN * t).multiply(q);
  }
  // ステーションの角速度（この座標系で）
  stationAngVel(t) {
    if (!this.track) return this.axis(t).multiplyScalar(this.omega);
    const { w } = this.track.sample(t);
    return w.applyQuaternion(this.tumbleQuat(t)).addScaledVector(X, this.orbitN);
  }
  // 反転の窓（ポートがこちら側を向いている時間）
  scanWindows(until) {
    const lim = Math.cos(this.sc.tumble.windowDeg * DEG);
    const h = 0.25;
    while (this.windowScanT < until) {
      const t = this.windowScanT;
      const z = Z.clone().applyQuaternion(this.track.sample(t).q);
      const open = z.dot(this.L0) > lim;
      const last = this.windows[this.windows.length - 1];
      if (open) {
        if (last && last[1] >= t - h * 1.5) last[1] = t;
        else this.windows.push([t, t]);
      }
      this.windowScanT += h;
    }
  }
  windowInfo(t = this.t) {
    if (!this.track) return null;
    this.scanWindows(t + 400);
    for (const [s, e] of this.windows) {
      if (t >= s && t <= e) return { open: true, remaining: e - t, next: 0 };
      if (s > t) return { open: false, remaining: 0, next: s - t, length: e - s };
    }
    return { open: false, remaining: 0, next: Infinity };
  }
  // 軌道力学（CW方程式）による見かけの加速度。座標: Y = 地球と反対（R-bar）, -Z = 進行方向（V-bar）, X = 軌道面の法線方向
  cwAccel(p, v) {
    const n = this.orbitN;
    if (!n) return new THREE.Vector3();
    return new THREE.Vector3(-n * n * p.x, 3 * n * n * p.y - 2 * n * v.z, 2 * n * v.y);
  }

  wobbleQuat(t) {
    if (this.track) return this.tumbleQuat(t);
    const th = this.sc.wobbleDeg * DEG;
    if (th === 0) return new THREE.Quaternion();
    const phi = (2 * Math.PI * t) / this.sc.wobblePeriod;
    const a = new THREE.Quaternion().setFromAxisAngle(Z, phi);
    const b = new THREE.Quaternion().setFromAxisAngle(X, th);
    const c = new THREE.Quaternion().setFromAxisAngle(Z, -phi);
    return a.multiply(b).multiply(c);
  }
  stationQuat(t) {
    if (this.track) return this.tumbleQuat(t);
    const spin = new THREE.Quaternion().setFromAxisAngle(Z, this.omega * t);
    return this.wobbleQuat(t).multiply(spin);
  }
  axis(t) {
    return Z.clone().applyQuaternion(this.wobbleQuat(t));
  }
  portPos(t) {
    return new THREE.Vector3(0, 0, PORT_Z).applyQuaternion(this.wobbleQuat(t));
  }
  portVel(t) {
    const h = 0.01;
    return this.portPos(t + h).sub(this.portPos(t - h)).multiplyScalar(1 / (2 * h));
  }
  markerDir(t) {
    return Y.clone().applyQuaternion(this.stationQuat(t));
  }

  rollAcc() {
    return this.sc.rollAcc ?? ROLL_ACC;
  }

  forward() {
    return Z.clone().applyQuaternion(this.q);
  }
  up() {
    return Y.clone().applyQuaternion(this.q);
  }
  // ドッキングポートの向き・画面上方向・位置（ワールド座標）
  dockDir() {
    return this.dock.F.clone().applyQuaternion(this.q);
  }
  dockUp() {
    return this.dock.U.clone().applyQuaternion(this.q);
  }
  dockPoint() {
    return this.pos.clone().add(this.dock.local.clone().applyQuaternion(this.q));
  }
  nosePos() {
    return this.dockPoint();
  }

  // 操作軸（機体座標）と、それぞれの角加速度の上限
  // ポート基準: W/S がポート方向、Q/E がポート軸まわりの回転。機体基準: 従来どおり機首基準。
  controlAxes(bodyFrame) {
    const fr = bodyFrame ? BODY_FRAME : { F: this.dock.F, U: this.dock.U, R: new THREE.Vector3().crossVectors(this.dock.F, this.dock.U) };
    const auth = (v) => (Math.abs(v.dot(this.dock.F)) > 0.9 ? this.rollAcc() : PY_ACC);
    return { R: fr.R, U: fr.U, F: fr.F, aR: auth(fr.R), aU: auth(fr.U), aF: auth(fr.F) };
  }
  // 回転差・マーカーを合わせるキー [ステーションと同じ向きへ回すキー, 逆向きのキー]
  spinKeys(bodyFrame) {
    if (!bodyFrame || this.dockType === 'nose') return ['Q', 'E'];
    return ['→', '←']; // 上部ポートを機体基準で操作するときはヨーで回る
  }

  // ---- 1ステップ進める ----
  step(dt, c) {
    if (this.status === 'docked') {
      this.t += dt;
      this.followStation();
      return;
    }
    if (this.status !== 'flying') return;
    this.t += dt;

    const t = this.t;
    const a = this.axis(t);
    const vP = this.portVel(t);
    const hasFuel = this.fuel > 0;

    const linA = LIN_ACC * (c.fine ? 0.15 : 1);
    const pyA = PY_ACC * (c.fine ? 0.15 : 1);
    const rlA = this.rollAcc() * (c.fine ? 0.1 : 1);

    const ax = this.controlAxes(c.bodyFrame);
    const authOf = (v) => (Math.abs(v.dot(this.dock.F)) > 0.9 ? rlA : pyA);
    const accB = new THREE.Vector3()
      .addScaledVector(ax.R, c.tx * linA)
      .addScaledVector(ax.U, c.ty * linA)
      .addScaledVector(ax.F, c.tz * linA);
    const angB = new THREE.Vector3()
      .addScaledVector(ax.R, c.rx * authOf(ax.R))
      .addScaledVector(ax.U, -c.ry * authOf(ax.U))
      .addScaledVector(ax.F, c.rz * authOf(ax.F));
    if (!hasFuel) {
      accB.set(0, 0, 0);
      angB.set(0, 0, 0);
    }
    const acc = accB.clone().applyQuaternion(this.q);
    const ang = angB.clone().applyQuaternion(this.q);
    // ステーション軸まわりの回転を手動で操作中か（入力の大半が軸まわり成分）
    const manualSpin = ang.length() > 1e-4 && Math.abs(ang.dot(a)) > 0.5 * ang.length();
    const D = this.dockDir();

    if (c.rotStop && hasFuel) {
      // 回転停止: すべての回転を止める（ポート軸まわりは強め、他は通常の上限）
      const want = this.w.clone().multiplyScalar(-3);
      const along = want.dot(D);
      const perp = want.clone().addScaledVector(D, -along);
      ang.add(clampLen(perp, PY_ACC)).addScaledVector(D, Math.max(-this.rollAcc(), Math.min(this.rollAcc(), along)));
    } else if (c.realign && hasFuel) {
      // 姿勢復帰: ステーション軸まわりの回転は保ったまま、ポートの向きを軸に合わせる
      const target = a.clone().negate();
      const e = new THREE.Vector3().crossVectors(D, target);
      const angle = Math.atan2(e.length(), D.dot(target));
      const wDes = e.lengthSq() > 1e-12 ? e.normalize().multiplyScalar(Math.min(0.6 * angle, 0.25)) : new THREE.Vector3();
      const wPerp = this.w.clone().addScaledVector(a, -this.w.dot(a));
      ang.add(clampLen(wDes.sub(wPerp).multiplyScalar(3), PY_ACC));
      this.usedAssist = true;
    } else if (c.sas && hasFuel && Math.abs(c.rx) < 0.01 && Math.abs(c.ry) < 0.01) {
      // SAS: ポート軸以外の回転（首振り）を止める。ポート軸まわりの回転は止めない
      const wperp = this.w.clone().addScaledVector(D, -this.w.dot(D));
      ang.add(clampLen(wperp.multiplyScalar(-2.5), PY_ACC));
    }
    // 横ずれ速度キャンセル（ポートに対する横方向の相対速度を打ち消す）
    if (c.killRel && hasFuel) {
      const vrel = this.vel.clone().sub(vP);
      const lat = vrel.addScaledVector(a, -vrel.dot(a));
      acc.add(clampLen(lat.multiplyScalar(-1.5), LIN_ACC));
    }

    // 回転ロック: 回転差が小さく、ロール入力が無いとき、ステーションと同じ回転数を保つ
    this.spinLockState = 'off';
    if (c.spinLock) {
      const err = this.stationAngVel(this.t).dot(a) - this.w.dot(a);
      if (manualSpin || c.rotStop) {
        this.spinLockState = 'manual';
      } else if (hasFuel && Math.abs(err) < SPIN_LOCK_CAPTURE_RPM * RPM) {
        const lim = this.rollAcc();
        ang.addScaledVector(a, Math.max(-lim, Math.min(lim, err * 4)));
        this.spinLockState = 'engaged';
        this.usedAssist = true;
      } else {
        this.spinLockState = 'armed';
      }
    }

    if (hasFuel) {
      this.fuel = Math.max(0, this.fuel - (acc.length() + 0.5 * ang.length()) * dt);
    }

    const qi = this.q.clone().invert();
    this.accBody.copy(acc).applyQuaternion(qi);
    this.angBody.copy(ang).applyQuaternion(qi);

    this.vel.addScaledVector(acc, dt).addScaledVector(this.cwAccel(this.pos, this.vel), dt); // 噴射 + 軌道力学
    this.pos.addScaledVector(this.vel, dt);
    this.w.addScaledVector(ang, dt);
    const wl = this.w.length();
    if (wl > 1e-9) {
      const dq = new THREE.Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt);
      this.q.premultiply(dq).normalize();
    }

    this.checkContact();

    if (this.status === 'flying') {
      if (this.sc.timeLimit && this.t >= this.sc.timeLimit) {
        this.fail('failed', 'ステーションが大気圏に突入した');
      } else if (this.pos.length() > (this.sc.farLimit || 600)) {
        this.fail('failed', 'ステーションから離れすぎた');
      }
    }
  }

  checkContact() {
    const Winv = this.wobbleQuat(this.t).invert();
    const nl = this.nosePos().applyQuaternion(Winv);
    const cl = this.pos.clone().applyQuaternion(Winv);
    const rN = Math.hypot(nl.x, nl.y);
    const rC = Math.hypot(cl.x, cl.y);

    if (nl.z <= PORT_Z && this.prevNoseZ > PORT_Z && rN < PORT_CAPTURE_R) {
      this.contact();
    } else if (nl.z < PORT_Z && nl.z > HUB_BACK && rN < HUB_R + 0.2) {
      this.fail('crashed', 'ドッキングポートの外側でハブに衝突した');
    } else if (cl.z < PORT_Z + 1 && cl.z > HUB_BACK && rC < HUB_R + 1.8) {
      this.fail('crashed', '船体がハブに接触した');
    } else if (Math.abs(cl.z) < 3.5 && rC < RING_R + 5 && rC > HUB_R) {
      this.fail('crashed', '回転するリング構造に衝突した');
    }
    if (this.status === 'flying') this.prevNoseZ = this.nosePos().applyQuaternion(Winv).z;
  }

  // ---- テレメトリ（HUD・オートパイロット用） ----
  telemetry() {
    const t = this.t;
    const a = this.axis(t);
    const P = this.portPos(t);
    const vP = this.portVel(t);
    // 以下 f/u/nose は「ドッキングポートの向き・画面上方向・位置」
    const f = this.dockDir();
    const u = this.dockUp();
    const right = new THREE.Vector3().crossVectors(f, u);
    const nose = this.dockPoint();
    const d = nose.clone().sub(P);
    const axial = d.dot(a);
    const lat = d.clone().addScaledVector(a, -axial);
    const vrel = this.vel.clone().sub(vP);
    const closing = -vrel.dot(a);
    const vlat = vrel.clone().addScaledVector(a, -vrel.dot(a));
    const align = f.angleTo(a.clone().negate()) / DEG;
    const shipSpin = this.w.dot(a);
    // ステーションに対する相対的な回転（ステーション自体の首振りも差し引く）
    const wS = this.stationAngVel(t);
    const targetSpin = wS.dot(a);
    const wrel = this.w.clone().sub(wS);
    const wperp = wrel.addScaledVector(a, -wrel.dot(a)).length();
    const phase = signedAngleAbout(u, this.markerDir(t), a) / DEG;
    return {
      a, P, vP, f, u, right, nose,
      range: d.length(),
      axial,
      lateral: lat.length(),
      latX: lat.dot(right),
      latY: lat.dot(u),
      latVec: lat,
      vlatVec: vlat,
      w: this.w.clone(),
      vlatX: vlat.dot(right),
      vlatY: vlat.dot(u),
      closing,
      align,
      targetRpm: targetSpin / RPM,
      shipRpm: shipSpin / RPM,
      dSpinRpm: (shipSpin - targetSpin) / RPM,
      rateDeg: wperp / DEG,
      phase,
      fuel: this.fuel / this.fuelMax,
      hull: this.hull,
      spinLock: this.spinLockState,
      window: this.windowInfo(t),
      centerDist: this.pos.length(),
      timeLeft: this.sc.timeLimit ? Math.max(0, this.sc.timeLimit - t) : null,
    };
  }

  evaluate(tm) {
    const tol = this.sc.tol;
    return [
      { key: 'closing', label: '接近速度', value: tm.closing, limit: tol.closing, unit: 'm/s', ok: tm.closing <= tol.closing },
      { key: 'lateral', label: '横ずれ', value: tm.lateral, limit: tol.lateral, unit: 'm', ok: tm.lateral <= tol.lateral },
      { key: 'align', label: '軸の角度', value: tm.align, limit: tol.align, unit: '°', ok: tm.align <= tol.align },
      { key: 'spin', label: '回転差', value: Math.abs(tm.dSpinRpm), limit: tol.spin, unit: 'rpm', ok: Math.abs(tm.dSpinRpm) <= tol.spin },
      { key: 'phase', label: 'マーカー', value: Math.abs(tm.phase), limit: tol.phase, unit: '°', ok: Math.abs(tm.phase) <= tol.phase },
      { key: 'rate', label: '首振り', value: tm.rateDeg, limit: tol.rate, unit: '°/s', ok: tm.rateDeg <= tol.rate },
    ];
  }

  contact() {
    const tm = this.telemetry();
    const checks = this.evaluate(tm);
    this.lastContact = { tm, checks };
    if (tm.closing > CRASH_SPEED) {
      this.fail('crashed', `秒速${tm.closing.toFixed(2)}mで激突した`);
      return;
    }
    if (checks.every((c) => c.ok)) {
      this.completeDocking(tm, checks);
      return;
    }
    // 弾かれる
    const bad = checks.filter((c) => !c.ok);
    this.hull -= 0.12 + Math.max(0, tm.closing - this.sc.tol.closing) * 0.8;
    const a = tm.a;
    const vrel = this.vel.clone().sub(tm.vP);
    vrel.addScaledVector(a, -vrel.dot(a));
    this.vel.copy(tm.vP).add(vrel).addScaledVector(a, Math.max(0.1, tm.closing * 0.5));
    this.w.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(0.05));
    // ポート面の外側へ押し戻す
    const Winv = this.wobbleQuat(this.t).invert();
    const nz = this.nosePos().applyQuaternion(Winv).z;
    this.pos.addScaledVector(a, PORT_Z + 0.05 - nz);
    this.events.push({ type: 'bump', reasons: bad.map((c) => c.label) });
    if (this.hull <= 0) {
      this.hull = 0;
      this.fail('crashed', '度重なる接触で船体が破損した');
    }
  }

  completeDocking(tm, checks) {
    this.status = 'docked';
    const Sq = this.stationQuat(this.t);
    const Si = Sq.clone().invert();
    this.relPos = this.pos.clone().applyQuaternion(Si);
    this.relQ = Si.clone().multiply(this.q);
    const precision = checks.reduce((s, c) => s + Math.max(0, 1 - c.value / c.limit), 0) / checks.length;
    const fuelRatio = this.fuel / this.fuelMax;
    let score = 400 + 400 * precision + 200 * fuelRatio * this.hull;
    if (this.usedAssist) score *= ASSIST_SCORE_FACTOR;
    score = Math.round(score);
    const rank = score >= 850 ? 'S' : score >= 750 ? 'A' : score >= 620 ? 'B' : 'C';
    this.result = { time: this.t, fuelUsed: 1 - fuelRatio, hull: this.hull, checks, score, rank, assist: this.usedAssist };
    this.events.push({ type: 'dock' });
  }

  followStation() {
    const Sq = this.stationQuat(this.t);
    this.pos.copy(this.relPos).applyQuaternion(Sq);
    this.q.copy(Sq).multiply(this.relQ);
    this.w.copy(this.stationAngVel(this.t));
    this.accBody.set(0, 0, 0);
    this.angBody.set(0, 0, 0);
  }

  fail(status, reason) {
    this.status = status;
    this.reason = reason;
    this.events.push({ type: status });
  }
}
