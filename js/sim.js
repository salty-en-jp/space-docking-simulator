// ドッキング物理シミュレーション（描画に依存しない純粋なロジック）
import * as THREE from '../vendor/three.module.min.js';

export const PORT_Z = 14;          // ステーション座標系でのドッキングポート面の位置
export const HUB_R = 4;            // 中央ハブの半径
export const HUB_BACK = -8;        // ハブ後端
export const PORT_CAPTURE_R = 3.0; // ポートが船を受け止められる半径
export const RING_R = 40;          // 居住リングの半径
export const NOSE = 3.2;           // 船の重心からドッキングカラーまでの距離

export const LIN_ACC = 0.5;        // 並進スラスタ加速度 [m/s^2]
export const PY_ACC = 0.35;        // ピッチ/ヨー角加速度 [rad/s^2]
export const ROLL_ACC = 1.0;       // ロール角加速度 [rad/s^2]
export const CRASH_SPEED = 1.5;    // これ以上の接近速度で接触すると大破

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
  extreme: {
    id: 'extreme',
    name: '限界',
    title: 'MISSION 03 ／ 制御不能',
    briefing:
      '爆発事故でステーション〈ハルシオン〉は毎分36回転の高速回転に陥り、軸もぶれながら大気圏へ落ちつつある。' +
      '残り5分。回転に同期できなければ、誰も帰れない。',
    spinRpm: 36,
    rollAcc: 1.0,
    wobbleDeg: 1.0,
    wobblePeriod: 40,
    timeLimit: 300,
    fuel: 90,
    start: { dist: 90, lateral: [6, 4], misalignDeg: 10, drift: [0.06, -0.05, -0.4] },
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

    const a = this.axis(0);
    const P = this.portPos(0);
    const e1 = Y.clone().addScaledVector(a, -Y.dot(a)).normalize();
    const e2 = new THREE.Vector3().crossVectors(a, e1);
    this.pos = P.clone()
      .addScaledVector(a, s.dist + NOSE)
      .addScaledVector(e2, s.lateral[0])
      .addScaledVector(e1, s.lateral[1]);
    const f = a.clone().negate().applyAxisAngle(e1, s.misalignDeg * DEG);
    this.q = quatFromForwardUp(f, e1);
    this.vel = new THREE.Vector3(...s.drift);
    this.w = new THREE.Vector3(0.004, -0.006, 0.01);
    this.prevNoseZ = Infinity;
  }

  // ---- ステーションの姿勢 ----
  wobbleQuat(t) {
    const th = this.sc.wobbleDeg * DEG;
    if (th === 0) return new THREE.Quaternion();
    const phi = (2 * Math.PI * t) / this.sc.wobblePeriod;
    const a = new THREE.Quaternion().setFromAxisAngle(Z, phi);
    const b = new THREE.Quaternion().setFromAxisAngle(X, th);
    const c = new THREE.Quaternion().setFromAxisAngle(Z, -phi);
    return a.multiply(b).multiply(c);
  }
  stationQuat(t) {
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
  nosePos() {
    return this.pos.clone().addScaledVector(this.forward(), NOSE);
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

    const accB = new THREE.Vector3(-c.tx * linA, c.ty * linA, c.tz * linA);
    const angB = new THREE.Vector3(-c.rx * pyA, -c.ry * pyA, c.rz * rlA);
    if (!hasFuel) {
      accB.set(0, 0, 0);
      angB.set(0, 0, 0);
    }
    const acc = accB.clone().applyQuaternion(this.q);
    const ang = angB.clone().applyQuaternion(this.q);

    // SAS: ピッチ/ヨー方向の回転を止める（ロールは止めない）
    if (c.sas && hasFuel && Math.abs(c.rx) < 0.01 && Math.abs(c.ry) < 0.01) {
      const f = this.forward();
      const wperp = this.w.clone().addScaledVector(f, -this.w.dot(f));
      ang.add(clampLen(wperp.multiplyScalar(-2.5), PY_ACC));
    }
    // 横ずれ速度キャンセル（ポートに対する横方向の相対速度を打ち消す）
    if (c.killRel && hasFuel) {
      const vrel = this.vel.clone().sub(vP);
      const lat = vrel.addScaledVector(a, -vrel.dot(a));
      acc.add(clampLen(lat.multiplyScalar(-1.5), LIN_ACC));
    }

    if (hasFuel) {
      this.fuel = Math.max(0, this.fuel - (acc.length() + 0.5 * ang.length()) * dt);
    }

    const qi = this.q.clone().invert();
    this.accBody.copy(acc).applyQuaternion(qi);
    this.angBody.copy(ang).applyQuaternion(qi);

    this.vel.addScaledVector(acc, dt);
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
      } else if (this.pos.length() > 600) {
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
    const f = this.forward();
    const u = this.up();
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.q);
    const nose = this.nosePos();
    const d = nose.clone().sub(P);
    const axial = d.dot(a);
    const lat = d.clone().addScaledVector(a, -axial);
    const vrel = this.vel.clone().sub(vP);
    const closing = -vrel.dot(a);
    const vlat = vrel.clone().addScaledVector(a, -vrel.dot(a));
    const align = f.angleTo(a.clone().negate()) / DEG;
    const shipSpin = this.w.dot(a);
    const wperp = this.w.clone().addScaledVector(a, -shipSpin).length();
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
      targetRpm: this.omega / RPM,
      shipRpm: shipSpin / RPM,
      dSpinRpm: (shipSpin - this.omega) / RPM,
      rateDeg: wperp / DEG,
      phase,
      fuel: this.fuel / this.fuelMax,
      hull: this.hull,
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
      this.dock(tm, checks);
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

  dock(tm, checks) {
    this.status = 'docked';
    const Sq = this.stationQuat(this.t);
    const Si = Sq.clone().invert();
    this.relPos = this.pos.clone().applyQuaternion(Si);
    this.relQ = Si.clone().multiply(this.q);
    const precision = checks.reduce((s, c) => s + Math.max(0, 1 - c.value / c.limit), 0) / checks.length;
    const fuelRatio = this.fuel / this.fuelMax;
    const score = Math.round(400 + 400 * precision + 200 * fuelRatio * this.hull);
    const rank = score >= 850 ? 'S' : score >= 750 ? 'A' : score >= 620 ? 'B' : 'C';
    this.result = { time: this.t, fuelUsed: 1 - fuelRatio, hull: this.hull, checks, score, rank };
    this.events.push({ type: 'dock' });
  }

  followStation() {
    const Sq = this.stationQuat(this.t);
    this.pos.copy(this.relPos).applyQuaternion(Sq);
    this.q.copy(Sq).multiply(this.relQ);
    this.w.copy(this.axis(this.t)).multiplyScalar(this.omega);
    this.accBody.set(0, 0, 0);
    this.angBody.set(0, 0, 0);
  }

  fail(status, reason) {
    this.status = status;
    this.reason = reason;
    this.events.push({ type: status });
  }
}
