// 惑星への降下・着陸・離陸（描画に依存しない）。単位は m, s。
// 座標: x = 右, y = 上, z = 手前（-z が前方）。着陸パッドは原点。

export const G = 11.8;            // 惑星表面の重力 [m/s^2]（地球の約1.2倍）
export const TMAX = 23;           // 最大推力の加速度 [m/s^2]（推力重量比 約2）
export const FUEL_RATE = 0.5;     // 全開噴射での推進剤消費 [% / s]
export const TILT_MAX = 25 * Math.PI / 180;
export const TILT_RATE = 50 * Math.PI / 180;
export const LEG = 1.0;           // 重心から脚の先まで
export const PAD_R = 30;
export const COLLECT_SEC = 15;    // データ回収にかかる時間（船内時間で15分）
export const ASCENT_ALT = 600;
export const ASCENT_VY = 15;
export const LIMITS = { vy: 3.0, vh: 2.0, tiltDeg: 10 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class LanderSim {
  constructor({ fuel }) {
    this.pos = [-160, 520, 200];
    this.vel = [7, -26, -9];
    this.tilt = [0, 0]; // [右へ傾く角, 前へ傾く角]
    this.fuel = fuel;
    this.phase = 'descent'; // descent | surface | ascent | orbit | crashed
    this.reason = '';
    this.collect = 0;
    this.throttle = 0;
    this.holdActive = false;
    this.usedAssist = false;
    this.landing = null;
    this.events = [];
  }

  up() {
    const [tx, tz] = this.tilt;
    const ux = Math.sin(tx), uz = -Math.sin(tz);
    const uy = Math.sqrt(Math.max(0, 1 - ux * ux - uz * uz));
    return [ux, uy, uz];
  }
  tiltDeg() { return Math.acos(this.up()[1]) * 180 / Math.PI; }
  alt() { return this.pos[1] - LEG; }
  padDist() { return Math.hypot(this.pos[0], this.pos[2]); }
  hSpeed() { return Math.hypot(this.vel[0], this.vel[2]); }

  // ctl: { thrust: 0..1, tx: -1..1（右へ）, tz: -1..1（前へ）, hold: 降下/上昇速度の自動保持 }
  step(dt, ctl) {
    if (this.phase === 'crashed' || this.phase === 'orbit') return;

    if (this.phase === 'surface') {
      this.collect = Math.min(1, this.collect + dt / COLLECT_SEC);
      this.throttle = 0;
      if (this.collect >= 1 && ctl.thrust > 0.5) {
        this.phase = 'ascent';
        this.events.push({ type: 'liftoff' });
      } else if (ctl.thrust > 0.5 && this.collect < 1) {
        this.events.push({ type: 'notready' });
      }
      if (this.phase === 'surface') return;
    }

    // 姿勢: 入力で傾け、離すと水平に戻る
    const want = [ctl.tx * TILT_MAX, ctl.tz * TILT_MAX];
    for (let i = 0; i < 2; i++) {
      const d = want[i] - this.tilt[i];
      this.tilt[i] += clamp(d, -TILT_RATE * dt, TILT_RATE * dt);
    }
    const u = this.up();

    // 推力
    let throttle = clamp(ctl.thrust, 0, 1);
    this.holdActive = false;
    if (ctl.hold && throttle < 0.01) {
      const alt = this.alt();
      const vt = this.phase === 'ascent' ? 20 : alt > 80 ? -6 : alt > 20 ? -3 : -1.2;
      throttle = clamp((G + 2.0 * (vt - this.vel[1])) / (TMAX * u[1]), 0, 1);
      this.holdActive = true;
      this.usedAssist = true;
    }
    if (this.fuel <= 0) throttle = 0;
    this.throttle = throttle;
    this.fuel = Math.max(0, this.fuel - throttle * FUEL_RATE * dt);

    const a = [u[0] * TMAX * throttle, u[1] * TMAX * throttle - G, u[2] * TMAX * throttle];
    for (let i = 0; i < 3; i++) {
      this.vel[i] += a[i] * dt;
      this.pos[i] += this.vel[i] * dt;
    }

    if (this.alt() <= 0) this.touchdown();
    if (this.phase === 'ascent' && this.pos[1] >= ASCENT_ALT && this.vel[1] >= ASCENT_VY) {
      this.phase = 'orbit';
      this.events.push({ type: 'orbit' });
    }
  }

  touchdown() {
    const vy = -this.vel[1];
    const vh = this.hSpeed();
    const tilt = this.tiltDeg();
    const dist = this.padDist();
    this.pos[1] = LEG;
    const checks = [
      { label: '降下速度', value: vy, limit: LIMITS.vy, unit: 'm/s', ok: vy <= LIMITS.vy },
      { label: '水平速度', value: vh, limit: LIMITS.vh, unit: 'm/s', ok: vh <= LIMITS.vh },
      { label: '傾き', value: tilt, limit: LIMITS.tiltDeg, unit: '°', ok: tilt <= LIMITS.tiltDeg },
      { label: 'パッドまで', value: dist, limit: PAD_R, unit: 'm', ok: dist <= PAD_R },
    ];
    this.landing = checks;
    if (checks.every((c) => c.ok)) {
      if (this.phase === 'descent') {
        this.phase = 'surface';
        this.vel = [0, 0, 0];
        this.tilt = [0, 0];
        this.events.push({ type: 'landed' });
      } else {
        this.vel = [0, 0, 0]; // 離陸前に戻ってきた場合など
      }
    } else {
      this.phase = 'crashed';
      const bad = checks.filter((c) => !c.ok);
      this.reason = dist > PAD_R && bad.length === 1
        ? 'パッドの外の岩場に降りてしまい、機体が損傷した'
        : `着陸に失敗した（${bad.map((c) => c.label).join('・')}が許容範囲外）`;
      this.events.push({ type: 'crashed' });
    }
  }
}
