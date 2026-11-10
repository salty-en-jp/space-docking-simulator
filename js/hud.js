// ヘッドアップディスプレイ（レトロなベクター表示風）
import * as THREE from '../vendor/three.module.min.js';

const OK = '#7CFFB2';
const WARN = '#FFB347';
const BAD = '#FF5C5C';
const DIM = 'rgba(124,255,178,0.35)';

export class HUD {
  constructor(canvas, panel) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.panel = panel;
    this.rows = {};
    this.lastPanel = 0;
    const defs = [
      ['time', '経過時間'], ['left', '残り時間'], ['range', '距離'], ['closing', '接近速度'],
      ['lateral', '横ずれ'], ['align', '軸の角度'], ['target', '目標の回転'], ['ship', '自船の回転'],
      ['spin', '回転差'], ['phase', 'マーカー'], ['rate', '首振り'], ['fuel', '推進剤'], ['hull', '船体'],
      ['state', 'ステーション'], ['window', '窓'], ['center', '中心まで'], ['warp', '時間加速'],
    ];
    panel.innerHTML = '';
    // スマホなど小さい画面では隠す補助的な行
    const minor = new Set(['time', 'target', 'ship', 'rate', 'hull', 'center']);
    for (const [k, label] of defs) {
      const row = document.createElement('div');
      row.className = minor.has(k) ? 'row minor' : 'row';
      row.innerHTML = `<span class="k">${label}</span><span class="v"></span>`;
      panel.appendChild(row);
      this.rows[k] = { row, v: row.querySelector('.v') };
    }
  }

  resize(w, h, dpr) {
    this.cv.width = w * dpr;
    this.cv.height = h * dpr;
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
  }

  project(p, camera) {
    const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -0.1) return null;
    const n = p.clone().project(camera);
    return { x: (n.x * 0.5 + 0.5) * this.w, y: (-n.y * 0.5 + 0.5) * this.h };
  }

  setRow(k, text, level) {
    const r = this.rows[k];
    if (!r) return;
    r.v.textContent = text;
    r.row.style.color = level === 'ok' ? OK : level === 'warn' ? WARN : level === 'bad' ? BAD : '';
    r.row.style.display = text === null ? 'none' : '';
  }

  draw(sim, tm, camera, opts) {
    const c = this.cx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (!opts.visible) return;
    const tol = sim.sc.tol;
    const lvl = (v, lim) => (v <= lim ? 'ok' : v <= lim * 3 ? 'warn' : 'bad');
    const col = (l) => (l === 'ok' ? OK : l === 'warn' ? WARN : BAD);
    c.lineWidth = 1.5;
    c.font = '12px "Share Tech Mono", ui-monospace, monospace';

    if (sim.status === 'flying') {
      // ---- 進入コリドー（ステーションと一緒に回るゲート） ----
      const a = tm.a;
      const m = sim.markerDir(sim.t);
      const e1 = m.addScaledVector(a, -m.dot(a)).normalize();
      const e2 = new THREE.Vector3().crossVectors(a, e1);
      const gates = [2, 8, 16, 26, 40, 60];
      const alignedL = lvl(tm.lateral, tol.lateral) === 'ok' && lvl(tm.align, tol.align) === 'ok';
      for (const k of gates) {
        if (k > tm.axial + 5) continue;
        const center = tm.P.clone().addScaledVector(a, k);
        const s = 1.6;
        const pts = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) =>
          this.project(center.clone().addScaledVector(e1, i * s).addScaledVector(e2, j * s), camera));
        if (pts.some((p) => !p)) continue;
        c.strokeStyle = alignedL ? 'rgba(124,255,178,0.55)' : 'rgba(255,179,71,0.45)';
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.closePath();
        c.stroke();
        // 上向き（マーカー側）の目印
        const top = this.project(center.clone().addScaledVector(e1, s * 1.5), camera);
        if (top) {
          c.fillStyle = '#ff8a1f';
          c.fillRect(top.x - 2, top.y - 2, 4, 4);
        }
      }
      // ---- ドッキングポート ----
      const pp = this.project(tm.P, camera);
      if (pp) {
        c.strokeStyle = col(lvl(tm.lateral, tol.lateral));
        c.beginPath();
        c.moveTo(pp.x, pp.y - 9); c.lineTo(pp.x + 9, pp.y); c.lineTo(pp.x, pp.y + 9); c.lineTo(pp.x - 9, pp.y); c.closePath();
        c.stroke();
        c.fillStyle = c.strokeStyle;
        c.fillText(`PORT ${tm.range.toFixed(1)}m`, pp.x + 12, pp.y - 10);
      }
      // ---- 機首方向（ボアサイト） ----
      const bs = this.project(tm.nose.clone().addScaledVector(tm.f, 80), camera);
      if (bs) {
        c.strokeStyle = col(lvl(tm.align, tol.align));
        c.beginPath();
        c.arc(bs.x, bs.y, 14, 0, Math.PI * 2);
        c.moveTo(bs.x - 26, bs.y); c.lineTo(bs.x - 14, bs.y);
        c.moveTo(bs.x + 14, bs.y); c.lineTo(bs.x + 26, bs.y);
        c.moveTo(bs.x, bs.y - 26); c.lineTo(bs.x, bs.y - 14);
        c.stroke();
      }
    }

    // ---- 下部ゲージ ----
    const gy = Math.min(this.h - 70, opts.bottom - 50);
    const gx = this.w / 2;
    this.drawSpinGauge(c, gx - 170, gy, tm, tol);
    this.drawPhaseDial(c, gx + 20, gy, tm, tol);
    this.drawLateralBox(c, gx + 110, gy, tm, tol);
    if (sim.orbitN) this.drawOrbitMap(c, sim, tm, opts);

    // ---- 右パネル（DOM、10Hz更新） ----
    const now = performance.now();
    if (now - this.lastPanel > 100) {
      this.lastPanel = now;
      const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
      const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      this.setRow('time', mmss(sim.t));
      this.setRow('left', tm.timeLeft === null ? null : mmss(tm.timeLeft), tm.timeLeft !== null && tm.timeLeft < 60 ? 'bad' : 'warn');
      this.setRow('range', `${f1(tm.range)} m`);
      const closeLvl = tm.closing > 1.5 ? 'bad' : tm.axial < 10 ? lvl(Math.max(0, tm.closing), tol.closing) : '';
      this.setRow('closing', `${tm.closing >= 0 ? '+' : ''}${f2(tm.closing)} m/s`, closeLvl);
      this.setRow('lateral', `${f2(tm.lateral)} m`, lvl(tm.lateral, tol.lateral));
      this.setRow('align', `${f1(tm.align)}°`, lvl(tm.align, tol.align));
      this.setRow('target', `${f1(tm.targetRpm)} rpm ↺`);
      this.setRow('ship', `${f1(tm.shipRpm)} rpm`);
      const ds = tm.dSpinRpm;
      const [kPlus, kMinus] = opts.spinKeys || ['Q', 'E'];
      this.setRow('spin', `${ds >= 0 ? '+' : ''}${f2(ds)} rpm ${Math.abs(ds) > tol.spin ? (ds < 0 ? `［${kPlus}］` : `［${kMinus}］`) : ''}`, lvl(Math.abs(ds), tol.spin));
      const ph = tm.phase;
      this.setRow('phase', `${ph >= 0 ? '+' : ''}${f1(ph)}° ${Math.abs(ph) > tol.phase ? (ph > 0 ? `［${kPlus}］` : `［${kMinus}］`) : ''}`, lvl(Math.abs(ph), tol.phase));
      this.setRow('rate', `${f1(tm.rateDeg)}°/s`, lvl(tm.rateDeg, tol.rate));
      this.setRow('fuel', `${Math.round(tm.fuel * 100)} %`, tm.fuel > 0.3 ? 'ok' : tm.fuel > 0.1 ? 'warn' : 'bad');
      this.setRow('hull', `${Math.round(tm.hull * 100)} %`, tm.hull > 0.7 ? 'ok' : tm.hull > 0.35 ? 'warn' : 'bad');
      // 転がるステーション・軌道力学のステージだけ
      const w = tm.window;
      if (w) {
        const facing = w.open;
        const awayish = !facing && tm.axial < -5;
        this.setRow('state', facing ? '静穏・こちら向き' : awayish ? '背中向き' : '反転中', facing ? 'ok' : awayish ? 'warn' : 'bad');
        this.setRow('window', facing ? `残り ${w.remaining.toFixed(0)} 秒` : `次まで ${Math.min(999, w.next).toFixed(0)} 秒`, facing ? (w.remaining > 40 ? 'ok' : 'warn') : '');
        this.setRow('center', `${tm.centerDist.toFixed(0)} m`, tm.centerDist < 50 && !facing ? 'bad' : '');
      } else {
        ['state', 'window', 'center'].forEach((k) => this.setRow(k, null));
      }
      this.setRow('warp', sim.orbitN ? `×${opts.warp || 1}` : null);
    }
  }

  label(c, text, x, y, color = DIM) {
    c.fillStyle = color;
    c.fillText(text, x, y);
  }

  // 回転差ゲージ: 中央が一致、左右に自船の回転の過不足
  drawSpinGauge(c, x, y, tm, tol) {
    const W = 140, H = 10;
    const range = Math.max(tol.spin * 6, 3);
    c.strokeStyle = DIM;
    c.strokeRect(x, y, W, H);
    const okW = (tol.spin / range) * (W / 2);
    c.fillStyle = 'rgba(124,255,178,0.18)';
    c.fillRect(x + W / 2 - okW, y, okW * 2, H);
    const v = Math.max(-1, Math.min(1, tm.dSpinRpm / range));
    const px = x + W / 2 + v * (W / 2);
    const ok = Math.abs(tm.dSpinRpm) <= tol.spin;
    c.fillStyle = ok ? OK : WARN;
    c.fillRect(px - 2, y - 4, 4, H + 8);
    const lockText = { engaged: '  ロック作動中', armed: '  ロック待機', manual: '  ロック（手動中）' }[tm.spinLock] || '';
    this.label(c, '回転同期' + lockText, x, y - 8, tm.spinLock === 'engaged' ? OK : ok ? OK : DIM);
    if (tm.spinLock === 'engaged') {
      c.strokeStyle = OK;
      c.strokeRect(x - 3, y - 3, W + 6, H + 6);
    }
    this.label(c, '遅い', x, y + H + 14);
    this.label(c, '速い', x + W - 24, y + H + 14);
  }

  // マーカー位相ダイヤル
  drawPhaseDial(c, x, y, tm, tol) {
    const R = 20, cx = x + R, cy = y + 5;
    const ok = Math.abs(tm.phase) <= tol.phase;
    c.strokeStyle = DIM;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    // 自船（上固定）
    c.strokeStyle = OK;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - R); c.stroke();
    // ステーションのマーカー（画面上は反時計回りが +）
    const ang = -Math.PI / 2 - (tm.phase * Math.PI) / 180;
    c.strokeStyle = ok ? OK : '#ff8a1f';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); c.stroke();
    c.lineWidth = 1.5;
    this.label(c, 'マーカー', x - 4, y - 23, ok ? OK : DIM);
  }

  // 横ずれ表示: 軸に対する自船の位置（中央が軸、上下左右は自船から見た向き）。
  // 表示は自船と一緒に回る座標系なので、自船が回転していると点は渦を巻くように動く。
  // その見かけの動きを、この先 PREDICT 秒の予測線として描く。
  drawLateralBox(c, x, y, tm, tol) {
    const S = 64, cx = x + S / 2, cy = y + 5;
    // 中心付近は等倍、遠くは tanh で圧縮して枠内に収める
    const R0 = Math.max(tol.lateral * 5, 2);
    const map = (mx, my) => {
      const r = Math.hypot(mx, my);
      if (r < 1e-9) return [cx, cy];
      const k = ((S / 2 - 3) * Math.tanh(r / R0)) / r;
      return [cx + mx * k, cy - my * k];
    };
    const ok = tm.lateral <= tol.lateral;
    c.strokeStyle = DIM;
    c.strokeRect(cx - S / 2, cy - S / 2, S, S);
    c.beginPath();
    c.arc(cx, cy, (S / 2 - 3) * Math.tanh(tol.lateral / R0), 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 4, cy); c.lineTo(cx + 4, cy); c.moveTo(cx, cy - 4); c.lineTo(cx, cy + 4);
    c.stroke();

    // 予測: 慣性系では横ずれは直線的に変化し、表示の軸は自船の角速度で回る
    const PREDICT = 3, N = 30;
    const wl = tm.w.length();
    const axis = wl > 1e-9 ? tm.w.clone().divideScalar(wl) : null;
    const L = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3(), q = new THREE.Quaternion();
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const tau = (i / N) * PREDICT;
      L.copy(tm.latVec).addScaledVector(tm.vlatVec, tau);
      R.copy(tm.right); U.copy(tm.u);
      if (axis) { q.setFromAxisAngle(axis, wl * tau); R.applyQuaternion(q); U.applyQuaternion(q); }
      pts.push(map(L.dot(R), L.dot(U)));
    }
    const col = ok ? OK : WARN;
    c.save();
    c.beginPath();
    c.rect(cx - S / 2, cy - S / 2, S, S);
    c.clip();
    for (let i = 1; i < pts.length; i++) {
      c.strokeStyle = col;
      c.globalAlpha = 0.9 * (1 - i / pts.length) + 0.1;
      c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke();
    }
    c.globalAlpha = 1;
    // 1秒後の位置に小さな目印
    const p1 = pts[Math.round(N / PREDICT)];
    c.strokeStyle = col;
    c.strokeRect(p1[0] - 2, p1[1] - 2, 4, 4);
    c.restore();

    // 現在位置
    const [px, py] = map(tm.latX, tm.latY);
    c.fillStyle = col;
    c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill();
    this.label(c, '横ずれ（3秒予測）', x - 10, y - 34, ok ? OK : DIM);
  }

  // 軌道図（横から見た図）: 横 = 進行方向（V-bar）、縦 = 地球と反対向き（R-bar）。
  // 噴射しなかった場合の予測軌道を、CW方程式の解析解で半周回ぶん描く。
  drawOrbitMap(c, sim, tm, opts) {
    const small = this.w < 720 || this.h < 500;
    const W = small ? 150 : 210, H = small ? 100 : 140;
    const x0 = small ? 8 : 16, y0 = opts.mapTop;
    c.fillStyle = 'rgba(4,14,10,0.72)';
    c.fillRect(x0, y0, W, H);
    c.strokeStyle = DIM;
    c.strokeRect(x0, y0, W, H);
    const n = sim.orbitN;
    // CW座標: x = 上（Y）, y = 進行方向（-Z）
    const px = sim.pos.y, py = -sim.pos.z, vx = sim.vel.y, vy = -sim.vel.z;
    const pts = [];
    const Tm = Math.PI / n; // 半周回
    for (let i = 0; i <= 90; i++) {
      const t = (i / 90) * Tm, nt = n * t, cs = Math.cos(nt), sn = Math.sin(nt);
      const x = (4 - 3 * cs) * px + (sn / n) * vx + (2 / n) * (1 - cs) * vy;
      const y = 6 * (sn - nt) * px + py - (2 / n) * (1 - cs) * vx + ((4 * sn - 3 * nt) / n) * vy;
      pts.push([y, x]);
    }
    const span = Math.max(120, Math.hypot(px, py) * 1.3, ...pts.slice(0, 45).map(([a, b]) => Math.hypot(a, b) * 0.8));
    const sc = Math.min(W, H * 1.4) / 2 / span;
    const cx = x0 + W / 2, cy = y0 + H / 2;
    c.save();
    c.beginPath(); c.rect(x0, y0, W, H); c.clip();
    // 軸と、反転中に危ない範囲（中心から約46m）
    c.strokeStyle = 'rgba(124,255,178,0.2)';
    c.beginPath(); c.moveTo(x0, cy); c.lineTo(x0 + W, cy); c.moveTo(cx, y0); c.lineTo(cx, y0 + H); c.stroke();
    c.strokeStyle = 'rgba(255,92,92,0.5)';
    c.beginPath(); c.arc(cx, cy, Math.max(2, 46 * sc), 0, Math.PI * 2); c.stroke();
    // 予測軌道
    c.strokeStyle = 'rgba(124,255,178,0.85)';
    c.beginPath();
    pts.forEach(([a, b], i) => (i ? c.lineTo(cx + a * sc, cy - b * sc) : c.moveTo(cx + a * sc, cy - b * sc)));
    c.stroke();
    // ステーションと自船
    c.fillStyle = '#e8f0ff';
    c.fillRect(cx - 2, cy - 2, 4, 4);
    c.fillStyle = WARN;
    c.beginPath(); c.arc(cx + py * sc, cy - px * sc, 3.5, 0, Math.PI * 2); c.fill();
    c.restore();
    c.font = '10px "Zen Kaku Gothic New", sans-serif';
    c.fillStyle = DIM;
    c.fillText('進行方向 →', x0 + W - 62, cy - 4);
    c.fillText('↑ 地球と反対', cx + 4, y0 + 12);
    c.fillText(`軌道図（横から・半径 ${span.toFixed(0)} m）`, x0 + 4, y0 + H - 5);
  }
}
