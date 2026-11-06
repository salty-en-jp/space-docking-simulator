// マニューバ編の自動操縦（テストでクリア可能性を確かめる用・デモ用）
// プレイヤーと同じ操作入力だけを使う。
import { THRUST, CAPTURE } from './orbit.js';
import { G, TMAX } from './lander.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class OrbitGuide {
  constructor() { this.state = 'wait'; this.dv0 = 0; this.warp = 1; }

  // 指定方向へ機首を向ける操作量
  turn(o, ang) { return clamp(wrap(ang - o.s.heading) * 4, -1, 1); }

  update(o) {
    const ctl = { rot: 0, thrust: 0 };
    const rel = o.relative();
    const b = o.targetBody();
    const cap = CAPTURE[o.target];
    this.warp = 1;
    if (this.state === 'wait') {
      const w = o.transferWindow();
      if (w) {
        o.hold = w.dv < 0 ? 'retrograde' : 'prograde';
        const aligned = Math.abs(wrap(o.holdAngle() - o.s.heading)) < 0.03;
        // 向きがそろっていて、噴射まで余裕があるときだけ時間加速
        this.warp = aligned && w.wait - w.burnTime / 2 > 1.0 ? 8 : 1;
        if (aligned && w.wait <= w.burnTime / 2) { this.state = 'burn'; this.dv0 = o.dvUsed; this.need = Math.abs(w.dv); }
      }
    }
    if (this.state === 'burn') {
      ctl.thrust = 1;
      if (o.dvUsed - this.dv0 >= this.need) { this.state = 'coast'; ctl.thrust = 0; }
      return ctl;
    }
    if (this.state === 'coast') {
      const p = o.predict(8);
      this.warp = p.closest.tau > 1.0 ? 8 : 1;
      if (rel.dist < 0.2) this.state = 'rendezvous';
    }
    if (this.state === 'rendezvous') {
      o.hold = null;
      const [px, py] = b.pos(o.t);
      const [tvx, tvy] = b.vel(o.t);
      const dx = px - o.s.x, dy = py - o.s.y;
      const d = Math.hypot(dx, dy);
      const vApp = Math.min(0.5 * d, cap.rel * 0.6);
      const want = [tvx + (dx / d) * vApp, tvy + (dy / d) * vApp];
      const ex = want[0] - o.s.vx, ey = want[1] - o.s.vy;
      const e = Math.hypot(ex, ey);
      const ang = Math.atan2(ey, ex);
      ctl.rot = this.turn(o, ang);
      const aligned = Math.abs(wrap(ang - o.s.heading)) < 0.25;
      if (aligned && e > 0.01) ctl.thrust = clamp(e / (THRUST * 0.2), 0.05, 1);
    }
    return ctl;
  }
}

export class LanderGuide {
  update(l) {
    const ctl = { thrust: 0, tx: 0, tz: 0, hold: false };
    if (l.phase === 'surface') { ctl.thrust = l.collect >= 1 ? 1 : 0; return ctl; }
    if (l.phase === 'ascent') { ctl.thrust = 1; return ctl; }
    const [x, , z] = l.pos;
    const [vx, vy, vz] = l.vel;
    const alt = l.alt();
    // 水平: パッドへ向かう速度を作る（右 = +x, 前 = -z）
    const vxDes = clamp(-0.08 * x, -12, 12);
    const vzDes = clamp(-0.08 * z, -12, 12);
    ctl.tx = clamp(0.25 * (vxDes - vx), -1, 1);
    ctl.tz = clamp(-0.25 * (vzDes - vz), -1, 1);
    // 垂直: 高度に応じた降下速度
    const vyDes = -clamp(0.12 * alt + 0.8, 0.8, 30);
    const u = l.up();
    ctl.thrust = clamp((G + 2.5 * (vyDes - vy)) / (TMAX * u[1]), 0, 1);
    return ctl;
  }
}
