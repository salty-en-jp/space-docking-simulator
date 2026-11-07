// 2D軌道図の描画（真上から見たブラックホール周辺）
import { R_PLANET, R_MOTHER, R_FAIL, R_HORIZON, CAPTURE } from './orbit.js';
import { NAMES } from '../names.js';

const C = {
  bg: '#02040a',
  path: 'rgba(124,255,178,0.9)',
  dim: 'rgba(124,255,178,0.35)',
  planet: '#9fd8ff',
  mother: '#e8f0ff',
  ship: '#ffb347',
  danger: 'rgba(255,92,92,0.55)',
  text: '#bfe9d0',
};

export class OrbitView {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.zoom = false;
    this.stars = Array.from({ length: 260 }, () => [Math.random(), Math.random(), Math.random()]);
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
  }

  // 画面の使える範囲（パネルやボタンを避ける）
  setViewport(vp) { this.vp = vp; }

  draw(o, pred, t) {
    const c = this.cx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.w, this.h);
    for (const [sx, sy, b] of this.stars) {
      c.fillStyle = `rgba(255,255,255,${0.2 + b * 0.5})`;
      c.fillRect(sx * this.w, sy * this.h, 1.2, 1.2);
    }

    const vp = this.vp || { x: 0, y: 0, w: this.w, h: this.h };
    const cx0 = vp.x + vp.w / 2, cy0 = vp.y + vp.h / 2;
    const base = Math.min(vp.w, vp.h) / 2 / (R_MOTHER * 1.12);
    let scale = base, ox = 0, oy = 0;
    if (this.zoom) {
      // 自船と目標の中間を中心に、両方が入る倍率
      const [tx, ty] = o.targetBody().pos(o.t);
      ox = (o.s.x + tx) / 2; oy = (o.s.y + ty) / 2;
      const span = Math.max(0.25, Math.hypot(o.s.x - tx, o.s.y - ty) * 0.75);
      scale = Math.min(vp.w, vp.h) / 2 / span;
    }
    const X = (x) => cx0 + (x - ox) * scale;
    const Y = (y) => cy0 - (y - oy) * scale;
    const R = (r) => r * scale;

    // 降着円盤とブラックホール
    const g = c.createRadialGradient(X(0), Y(0), R(R_HORIZON), X(0), Y(0), R(0.75));
    g.addColorStop(0, 'rgba(255,230,180,0.95)');
    g.addColorStop(0.25, 'rgba(255,170,80,0.55)');
    g.addColorStop(0.7, 'rgba(200,80,30,0.12)');
    g.addColorStop(1, 'rgba(200,80,30,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(X(0), Y(0), R(0.75), 0, Math.PI * 2); c.fill();
    c.fillStyle = '#000';
    c.beginPath(); c.arc(X(0), Y(0), R(R_HORIZON), 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,240,210,0.9)';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(X(0), Y(0), R(R_HORIZON) + 1, 0, Math.PI * 2); c.stroke();
    // 脱出不能ライン
    c.setLineDash([4, 5]);
    c.strokeStyle = C.danger;
    c.beginPath(); c.arc(X(0), Y(0), R(R_FAIL), 0, Math.PI * 2); c.stroke();
    // 軌道
    c.strokeStyle = 'rgba(159,216,255,0.35)';
    c.beginPath(); c.arc(X(0), Y(0), R(R_PLANET), 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(232,240,255,0.25)';
    c.beginPath(); c.arc(X(0), Y(0), R(R_MOTHER), 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.font = '12px "Zen Kaku Gothic New", sans-serif';
    if (!this.zoom) {
      // 名前が長くても惑星・母船の名前と重ならないよう、真下に中央揃えで
      c.fillStyle = 'rgba(255,220,170,0.8)';
      c.textAlign = 'center';
      c.fillText(NAMES.blackHole, X(0), Y(0) + Math.max(R(0.75), 30) + 14);
      c.textAlign = 'left';
    }

    // 予測軌道
    if (pred && pred.path.length > 1) {
      const n = pred.path.length;
      for (let i = 1; i < n; i++) {
        c.strokeStyle = pred.falls ? `rgba(255,92,92,${0.9 - 0.7 * i / n})` : `rgba(124,255,178,${0.9 - 0.75 * i / n})`;
        c.beginPath();
        c.moveTo(X(pred.path[i - 1][0]), Y(pred.path[i - 1][1]));
        c.lineTo(X(pred.path[i][0]), Y(pred.path[i][1]));
        c.stroke();
      }
      const mark = (p, label) => {
        if (!p) return;
        c.fillStyle = C.path;
        c.beginPath(); c.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); c.fill();
        c.fillText(`${label} ${p.r.toFixed(2)}`, X(p.x) + 6, Y(p.y) - 6);
      };
      mark(pred.peri, '近点');
      mark(pred.apo, '遠点');
      // 最接近
      const cl = pred.closest;
      if (cl && cl.ship && cl.tau > 0.05 && cl.dist < 1.0) {
        const tc = o.target === 'planet' ? C.planet : C.mother;
        c.setLineDash([3, 3]);
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.beginPath(); c.moveTo(X(cl.ship[0]), Y(cl.ship[1])); c.lineTo(X(cl.target[0]), Y(cl.target[1])); c.stroke();
        c.setLineDash([]);
        c.strokeStyle = C.ship;
        c.beginPath(); c.arc(X(cl.ship[0]), Y(cl.ship[1]), 5, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = tc;
        c.beginPath(); c.arc(X(cl.target[0]), Y(cl.target[1]), 5, 0, Math.PI * 2); c.stroke();
        const good = cl.dist < CAPTURE[o.target].dist * 3;
        c.fillStyle = good ? C.path : '#ffb347';
        c.fillText(`最接近 ${cl.dist.toFixed(3)}`, X(cl.target[0]) + 8, Y(cl.target[1]) + 14);
      }
    }

    // 惑星・母船
    const [px, py] = o.planet.pos(o.t);
    c.fillStyle = C.planet;
    c.beginPath(); c.arc(X(px), Y(py), Math.max(4, R(0.025)), 0, Math.PI * 2); c.fill();
    c.fillText(NAMES.planet, X(px) + 8, Y(py) - 8);
    const [mx, my] = o.mother.pos(o.t);
    c.fillStyle = C.mother;
    c.save(); c.translate(X(mx), Y(my)); c.rotate(Math.PI / 4); c.fillRect(-4, -4, 8, 8); c.restore();
    c.fillText(NAMES.mothership, X(mx) + 8, Y(my) - 8);
    // 目標の捕捉範囲
    const tb = o.targetBody().pos(o.t);
    if (R(CAPTURE[o.target].dist) > 6) {
      c.strokeStyle = 'rgba(124,255,178,0.4)';
      c.setLineDash([2, 3]);
      c.beginPath(); c.arc(X(tb[0]), Y(tb[1]), R(CAPTURE[o.target].dist), 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }

    // 自船
    const sx = X(o.s.x), sy = Y(o.s.y);
    c.save();
    c.translate(sx, sy);
    c.rotate(-o.s.heading);
    if (o.thrusting > 0) {
      c.fillStyle = `rgba(160,210,255,${0.5 + Math.random() * 0.4})`;
      c.beginPath(); c.moveTo(-6, -3); c.lineTo(-14 - Math.random() * 8, 0); c.lineTo(-6, 3); c.fill();
    }
    c.fillStyle = C.ship;
    c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, -5); c.lineTo(-3, 0); c.lineTo(-6, 5); c.closePath(); c.fill();
    c.restore();
    // 速度方向（順行）の目印
    const vang = Math.atan2(o.s.vy, o.s.vx);
    c.strokeStyle = 'rgba(255,179,71,0.6)';
    c.beginPath(); c.arc(sx + Math.cos(vang) * 22, sy - Math.sin(vang) * 22, 4, 0, Math.PI * 2); c.stroke();
    void t;
  }
}
