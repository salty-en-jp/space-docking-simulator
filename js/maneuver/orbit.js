// ブラックホール周りの2D軌道運動（描画に依存しない）
//
// 重力は擬ニュートン的なポテンシャル Φ = -GM / (r - RG)（パチンスキー＝ヴィータ型）。
// ニュートン重力と違って、近づくと引力が急に強まり、最内安定円軌道より内側では落ちていく。
// 軌道も閉じずに少しずつ回転する（近点移動）。
import { dilationAt, configureMapping } from './relativity.js';

export const GM = 1;
export const RG = 0.12;
export const R_PLANET = 1;
export const R_MOTHER = 6;
export const R_FAIL = 0.32;          // これより内側に入ったら脱出不能
export const R_HORIZON = 0.16;       // 描画用
export const THRUST = 0.25;          // 噴射の加速度 [軌道単位/時間単位^2]
export const ROT_RATE = 1.8;         // 機首の回転速度 [rad / 実時間秒]
export const FUEL_PER_DV = 30;       // Δv 1 あたりの推進剤 [%]
export const CAPTURE = {
  planet: { dist: 0.06, rel: 0.12 },
  mother: { dist: 0.12, rel: 0.08 },
};

configureMapping(R_PLANET, R_MOTHER);

export function vCirc(r) {
  return Math.sqrt(GM * r) / (r - RG);
}
export function omegaCirc(r) {
  return vCirc(r) / r;
}
// 惑星の公転周期が実時間30秒（時間加速1倍）になるよう時間の単位を決める
export const PLANET_PERIOD_REAL = 30;
export const REAL_SEC_PER_UNIT = (PLANET_PERIOD_REAL * omegaCirc(R_PLANET)) / (2 * Math.PI);
// 船の時計: 実時間1秒（加速1倍）= 船内時間1分
export const SHIP_MIN_PER_UNIT = REAL_SEC_PER_UNIT;

export function accel(x, y) {
  const r = Math.hypot(x, y);
  const f = -GM / ((r - RG) * (r - RG) * r);
  return [f * x, f * y];
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Body {
  constructor(r, phase0) {
    this.r = r;
    this.phase0 = phase0;
    this.w = omegaCirc(r);
  }
  angle(t) { return this.phase0 + this.w * t; }
  pos(t) { const a = this.angle(t); return [this.r * Math.cos(a), this.r * Math.sin(a)]; }
  vel(t) { const a = this.angle(t), v = this.w * this.r; return [-v * Math.sin(a), v * Math.cos(a)]; }
}

// 速度ベルレ法で1ステップ
function verlet(s, dt, ax0, ay0, thrustX, thrustY) {
  const hx = s.vx + 0.5 * dt * (ax0 + thrustX);
  const hy = s.vy + 0.5 * dt * (ay0 + thrustY);
  s.x += dt * hx;
  s.y += dt * hy;
  const [ax1, ay1] = accel(s.x, s.y);
  s.vx = hx + 0.5 * dt * (ax1 + thrustX);
  s.vy = hy + 0.5 * dt * (ay1 + thrustY);
  return [ax1, ay1];
}

// 円軌道 r1 から r2 へのホーマン遷移（このポテンシャルで数値的に求める）
// 戻り値: 必要な接線方向Δv（+ で順行）、遷移にかかる時間、その間に回る角度
export function hohmann(r1, r2) {
  const v1 = vCirc(r1);
  const sim = (dv) => {
    const s = { x: r1, y: 0, vx: 0, vy: v1 + dv };
    let [ax, ay] = accel(s.x, s.y);
    let t = 0;
    const dt = 0.002;
    let prevRad = 0;
    for (let i = 0; i < 400000; i++) {
      [ax, ay] = verlet(s, dt, ax, ay, 0, 0);
      t += dt;
      const r = Math.hypot(s.x, s.y);
      if (r < R_FAIL) return { r, t, ang: Math.atan2(s.y, s.x) };
      const rad = (s.x * s.vx + s.y * s.vy) / r;
      if (i > 10 && Math.sign(rad) !== Math.sign(prevRad) && prevRad !== 0) {
        let ang = Math.atan2(s.y, s.x);
        if (ang < 0) ang += 2 * Math.PI;
        return { r, t, ang };
      }
      prevRad = rad;
    }
    return null;
  };
  // 反対側の軌道点の半径が r2 になる Δv を二分法で探す
  let lo, hi;
  if (r2 < r1) { lo = -v1 * 0.95; hi = 0; } else { lo = 0; hi = v1 * 0.9; }
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    const res = sim(m);
    const r = res ? res.r : (r2 < r1 ? 0 : 1e9);
    if (r2 < r1) { if (r < r2) lo = m; else hi = m; } else { if (r < r2) lo = m; else hi = m; }
  }
  const dv = (lo + hi) / 2;
  const res = sim(dv);
  return { dv, time: res.t, sweep: res.ang };
}

export const TRANSFER_OUT = hohmann(R_MOTHER, R_PLANET);
export const TRANSFER_BACK = hohmann(R_PLANET, R_MOTHER);

export class OrbitSim {
  // ship: {x, y, vx, vy, heading}
  constructor({ ship, t0 = 0, planet, mother, fuel, target, clock }) {
    this.s = { ...ship };
    this.t = t0;
    this.planet = planet;
    this.mother = mother;
    this.fuel = fuel;
    this.target = target; // 'planet' | 'mother'
    this.hold = null;     // null | 'prograde' | 'retrograde' | 'target'
    this.thrusting = 0;
    this.status = 'flying'; // flying | captured | failed
    this.reason = '';
    this.clock = clock || { ship: 0, outside: 0 }; // 分単位: 自分の時計 / 外の世界の時計
    this.dvUsed = 0;
  }

  targetBody() { return this.target === 'planet' ? this.planet : this.mother; }

  // 目標方向の角度（保持モード用）
  holdAngle() {
    const s = this.s;
    if (this.hold === 'prograde') return Math.atan2(s.vy, s.vx);
    if (this.hold === 'retrograde') return Math.atan2(-s.vy, -s.vx);
    if (this.hold === 'target') {
      const [tvx, tvy] = this.targetBody().vel(this.t);
      return Math.atan2(-(s.vy - tvy), -(s.vx - tvx));
    }
    return null;
  }

  // dtUnits: シミュレーション時間, dtReal: 実時間（機首の回転用）
  step(dtUnits, dtReal, ctl) {
    if (this.status !== 'flying') return;
    const s = this.s;
    if (Math.abs(ctl.rot) > 0.01) {
      this.hold = null;
      s.heading += ctl.rot * ROT_RATE * dtReal;
    } else if (this.hold) {
      const want = this.holdAngle();
      const d = wrap(want - s.heading);
      const max = ROT_RATE * dtReal;
      s.heading += Math.max(-max, Math.min(max, d));
    }
    s.heading = wrap(s.heading);

    const throttle = this.fuel > 0 ? Math.max(0, Math.min(1, ctl.thrust)) : 0;
    this.thrusting = throttle;
    const tx = Math.cos(s.heading) * THRUST * throttle;
    const ty = Math.sin(s.heading) * THRUST * throttle;

    const n = Math.max(1, Math.ceil(dtUnits / 0.002));
    const h = dtUnits / n;
    let [ax, ay] = accel(s.x, s.y);
    for (let i = 0; i < n; i++) {
      [ax, ay] = verlet(s, h, ax, ay, tx, ty);
      const r = Math.hypot(s.x, s.y);
      const shipMin = h * SHIP_MIN_PER_UNIT;
      this.clock.ship += shipMin;
      this.clock.outside += shipMin * dilationAt(r);
      if (r < R_FAIL) {
        this.status = 'failed';
        this.reason = 'ブラックホールに近づきすぎて、脱出できなくなった';
        break;
      }
    }
    this.t += dtUnits;
    const dv = THRUST * throttle * dtUnits;
    this.dvUsed += dv;
    this.fuel = Math.max(0, this.fuel - dv * FUEL_PER_DV);

    const rel = this.relative();
    const cap = CAPTURE[this.target];
    if (this.status === 'flying' && rel.dist < cap.dist && rel.speed < cap.rel) this.status = 'captured';
  }

  r() { return Math.hypot(this.s.x, this.s.y); }
  dilation() { return dilationAt(this.r()); }

  relative() {
    const b = this.targetBody();
    const [px, py] = b.pos(this.t);
    const [vx, vy] = b.vel(this.t);
    return { dist: Math.hypot(this.s.x - px, this.s.y - py), speed: Math.hypot(this.s.vx - vx, this.s.vy - vy) };
  }

  // 噴射なしで飛んだ場合の予測軌道と、目標への最接近
  predict(horizon = 14, dt = 0.01) {
    const s = { x: this.s.x, y: this.s.y, vx: this.s.vx, vy: this.s.vy };
    const b = this.targetBody();
    let [ax, ay] = accel(s.x, s.y);
    const path = [[s.x, s.y]];
    let peri = { r: Infinity }, apo = { r: 0 };
    let closest = { dist: Infinity };
    let falls = false;
    const steps = Math.ceil(horizon / dt);
    let prevRad = (s.x * s.vx + s.y * s.vy);
    for (let i = 1; i <= steps; i++) {
      const tau = i * dt;
      [ax, ay] = verlet(s, dt, ax, ay, 0, 0);
      const r = Math.hypot(s.x, s.y);
      if (i % 3 === 0) path.push([s.x, s.y]);
      const rad = s.x * s.vx + s.y * s.vy;
      if (prevRad < 0 && rad >= 0 && r < peri.r) peri = { r, x: s.x, y: s.y, tau };
      if (prevRad > 0 && rad <= 0 && r > apo.r) apo = { r, x: s.x, y: s.y, tau };
      prevRad = rad;
      const [px, py] = b.pos(this.t + tau);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < closest.dist) closest = { dist: d, tau, ship: [s.x, s.y], target: [px, py] };
      if (r < R_FAIL) { falls = true; break; }
      if (r > 30) break;
    }
    return { path, peri: peri.r < Infinity ? peri : null, apo: apo.r > 0 ? apo : null, closest, falls };
  }

  // ホーマン遷移の噴射タイミング（ほぼ円軌道にいるときだけ意味がある）
  transferWindow() {
    const tr = this.target === 'planet' ? TRANSFER_OUT : TRANSFER_BACK;
    const r1 = this.target === 'planet' ? R_MOTHER : R_PLANET;
    const r = this.r();
    const v = Math.hypot(this.s.vx, this.s.vy);
    const circular = Math.abs(r - r1) / r1 < 0.08 && Math.abs(v - vCirc(r)) / vCirc(r) < 0.08;
    if (!circular) return null;
    const b = this.targetBody();
    const shipAng = Math.atan2(this.s.y, this.s.x);
    const rel = ((b.angle(this.t) - shipAng) % (2 * Math.PI) + 4 * Math.PI) % (2 * Math.PI);
    const req = (((tr.sweep - b.w * tr.time) % (2 * Math.PI)) + 4 * Math.PI) % (2 * Math.PI);
    const ws = omegaCirc(r);
    const rate = b.w - ws; // 相対位相の変化率
    let wait;
    if (rate > 0) wait = (((req - rel) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / rate;
    else wait = (((rel - req) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / -rate;
    return { wait, dv: tr.dv, burnTime: Math.abs(tr.dv) / THRUST };
  }
}
