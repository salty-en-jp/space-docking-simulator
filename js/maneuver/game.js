// マニューバ編の進行・入力・画面表示
import { REAL_SEC_PER_UNIT, CAPTURE, R_PLANET } from './orbit.js';
import { dilationAt } from './relativity.js';
import { createOutbound, createLanding, createReturn, landerClockTick, formatShipTime, formatOutside } from './mission.js';
import { HOURS_PER_YEAR } from './relativity.js';
import { OrbitView } from './orbitView.js';
import { LanderView } from './landerView.js';
import { onKey, isHeld, bindTouchButtons } from '../input.js';
import { NAMES } from '../names.js';

const $ = (id) => document.getElementById(id);
const WARPS = [1, 2, 4, 8, 16, 32];
const OK = '#7CFFB2', WARN = '#FFB347', BAD = '#FF5C5C';

export const MANEUVER_MISSION = {
  id: 'maneuver1',
  title: 'MANEUVER 01 ／ 時の惑星',
  briefing:
    `母船〈${NAMES.mothership}〉から、ブラックホール〈${NAMES.blackHole}〉のすぐそばを回る惑星〈${NAMES.planet}〉へ。` +
    `惑星の近くでは時間がおよそ6万倍ゆっくり進む。そこでの1時間は、外の世界の7年。データを回収して、できるだけ早く母船へ戻れ。`,
};

export class Maneuver {
  constructor({ renderer, audio, isTouch, onBest }) {
    this.renderer = renderer;
    this.audio = audio;
    this.isTouch = isTouch;
    this.onBest = onBest;
    this.active = false;
    this.paused = false;
    this.cv = $('mcanvas');
    this.orbitView = new OrbitView(this.cv);
    this.landerView = new LanderView();
    this.warpIdx = 0;
    this.predFrame = 0;
    this.msgUntil = 0;
    this.burnStart = null;
    this.bindKeys();
    bindTouchButtons($('mtouch'));
  }

  // ---------------- 開始・終了 ----------------
  start() {
    this.audio.start();
    this.active = true;
    this.paused = false;
    this.orbit = createOutbound();
    this.lander = null;
    this.stage = 'outbound'; // outbound | descent | return | transition | result
    this.warpIdx = 0;
    this.pred = null;
    this.usedHold = false;
    this.holdOn = false;
    this.view = 'orbit'; // orbit | lander
    this.transitionAt = 0;
    this.nextStage = null;
    ['mui', 'mcanvas'].forEach((id) => $(id).classList.remove('hidden'));
    $('mtouch').classList.toggle('hidden', !this.isTouch);
    const t = $('mtoast');
    t.innerHTML = `<h4>${MANEUVER_MISSION.title}</h4>${MANEUVER_MISSION.briefing}<br><small>（タップ / クリックで閉じる）</small>`;
    t.style.opacity = 1;
    t.classList.remove('gone');
    t.onclick = () => { this.toastUntil = 1; };
    this.toastUntil = performance.now() + 12000;
    this.applyStageUi();
    this.flash('', '');
  }
  restart() {
    $('result').classList.add('hidden');
    $('pause').classList.add('hidden');
    this.start();
  }
  stop() {
    this.active = false;
    ['mui', 'mcanvas', 'mtouch'].forEach((id) => $(id).classList.add('hidden'));
  }
  setPaused(on) {
    if (!this.active || this.stage === 'result') return;
    this.paused = on;
    $('pause').classList.toggle('hidden', !on);
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.orbitView.resize(w, h, dpr);
    this.landerView.resize(w, h);
  }

  isOrbitStage() { return this.stage === 'outbound' || this.stage === 'return'; }

  applyStageUi() {
    const orbit = this.view === 'orbit';
    document.querySelectorAll('#mtouch .orbit').forEach((e) => e.classList.toggle('hidden', !orbit));
    document.querySelectorAll('#mtouch .lander').forEach((e) => e.classList.toggle('hidden', orbit));
    const names = { outbound: `往路：${NAMES.planet}へ`, descent: `${NAMES.planet}へ降下`, return: `帰路：${NAMES.mothership}へ` };
    $('m-phase').textContent = names[this.stage] || $('m-phase').textContent;
    this.updateBadges();
  }

  updateBadges() {
    const b = [];
    if (this.isOrbitStage()) {
      b.push(`<span>時間加速 ×${WARPS[this.warpIdx]}</span>`);
      const holds = { prograde: '順行', retrograde: '逆行', target: '目標逆行' };
      if (this.orbit.hold) b.push(`<span class="lock">姿勢: ${holds[this.orbit.hold]}</span>`);
      if (this.orbitView.zoom) b.push('<span>拡大表示</span>');
    }
    if (this.lander) b.push(`<span class="${this.holdOn ? 'lock' : ''}">速度保持 ${this.holdOn ? 'ON' : 'OFF'}</span>`);
    $('m-badges').innerHTML = b.join('');
    const set = (key, on) => { const e = document.querySelector(`#mtouch [data-key="${key}"]`); if (e) e.classList.toggle('on', on); };
    if (this.orbit) {
      set('KeyP', this.orbit.hold === 'prograde');
      set('KeyR', this.orbit.hold === 'retrograde');
      set('KeyT', this.orbit.hold === 'target');
      set('KeyZ', this.orbitView.zoom);
    }
    set('KeyL', !!this.holdOn);
  }

  flash(text, cls = '', ms = 2500) {
    const m = $('mmsg');
    m.textContent = text;
    m.className = cls;
    this.msgUntil = performance.now() + ms;
  }

  // ---------------- 入力 ----------------
  bindKeys() {
    const act = (fn) => () => { if (this.active && !this.paused && this.stage !== 'result') fn(); };
    onKey('Escape', () => { if (this.active && this.stage !== 'result') this.setPaused(!this.paused); });
    const setHold = (h) => act(() => {
      if (!this.isOrbitStage()) return;
      this.orbit.hold = this.orbit.hold === h ? null : h;
      this.updateBadges();
    });
    onKey('KeyP', setHold('prograde'));
    onKey('KeyR', setHold('retrograde'));
    onKey('KeyT', setHold('target'));
    onKey('KeyZ', act(() => { this.orbitView.zoom = !this.orbitView.zoom; this.updateBadges(); }));
    onKey('Comma', act(() => { this.warpIdx = Math.max(0, this.warpIdx - 1); this.updateBadges(); }));
    onKey('Period', act(() => { if (this.isOrbitStage()) { this.warpIdx = Math.min(WARPS.length - 1, this.warpIdx + 1); this.updateBadges(); } }));
    onKey('KeyL', act(() => { this.holdOn = !this.holdOn; this.updateBadges(); }));
  }

  orbitControls() {
    const k = (c) => (isHeld(c) ? 1 : 0);
    return {
      rot: (k('KeyA') || k('ArrowLeft')) - (k('KeyD') || k('ArrowRight')),
      thrust: k('KeyW') || k('ArrowUp') || k('Space'),
    };
  }
  landerControls() {
    const k = (c) => (isHeld(c) ? 1 : 0);
    return {
      thrust: k('KeyW') || k('Space'),
      tx: (k('ArrowRight') || k('KeyD')) - (k('ArrowLeft') || k('KeyA')),
      tz: k('ArrowUp') - k('ArrowDown'),
      hold: !!this.holdOn,
    };
  }

  // ---------------- 毎フレーム ----------------
  frame(dtReal, now) {
    if (!this.active) return;
    const running = !this.paused && this.stage !== 'result';

    if (running && this.stage === 'transition' && now > this.transitionAt) {
      this.nextStage();
    }

    if (running && this.isOrbitStage()) {
      const ctl = this.orbitControls();
      if (ctl.thrust && this.warpIdx > 0) { this.warpIdx = 0; this.updateBadges(); }
      const o = this.orbit;
      if (ctl.thrust && !this.burnStart) this.burnStart = o.dvUsed;
      if (!ctl.thrust && this.burnStart !== null && o.thrusting === 0) this.burnStart = null;
      const holdBefore = o.hold;
      o.step((dtReal / REAL_SEC_PER_UNIT) * WARPS[this.warpIdx], dtReal, ctl);
      if (holdBefore !== o.hold) this.updateBadges();
      if (o.status === 'captured') this.onCaptured();
      else if (o.status === 'failed') this.finish(false, o.reason);
      if (++this.predFrame % 4 === 1 || !this.pred) {
        const rel = o.relative();
        this.pred = o.predict(rel.dist < 0.6 ? 6 : 24);
      }
    } else if (running && this.stage === 'descent') {
      const l = this.lander;
      l.step(dtReal, this.landerControls());
      landerClockTick(this.orbit.clock, dtReal); // 実時間1秒 = 船内時間1分
      if (l.holdActive) this.usedHold = true;
      for (const e of l.events.splice(0)) this.onLanderEvent(e);
    }

    this.render(now);
    this.updateUi(now);
    // 音
    const o = this.orbit;
    const dil = this.view === 'lander' ? dilationAt(R_PLANET) : o.dilation();
    const tension = Math.min(1, Math.log10(dil) / 4.8);
    const thrust = this.stage === 'descent' && this.lander ? this.lander.throttle : o.thrusting;
    this.audio.update(running ? tension : 0, running ? thrust : 0);
  }

  onCaptured() {
    const o = this.orbit;
    if (this.stage === 'outbound') {
      this.flash(`${NAMES.planet}の重力に捕まった — 降下開始`, '', 2500);
      this.audio.beep(1200, 0.08, 3);
      this.goTransition(2200, () => {
        this.lander = createLanding(o);
        this.stage = 'descent';
        this.view = 'lander';
        this.applyStageUi();
        this.flash('W で噴射して減速。L で降下速度の自動保持', '', 4000);
      });
    } else if (this.stage === 'return') {
      this.audio.clunk();
      this.audio.triumph();
      this.flash(`${NAMES.mothership}に帰還！`, 'big', 4000);
      this.goTransition(3500, () => this.finish(true));
    }
  }

  onLanderEvent(e) {
    const l = this.lander;
    if (e.type === 'landed') {
      this.audio.clunk();
      this.flash('着陸成功！ データ回収中… 外の世界では時間が飛ぶように過ぎていく', '', 5000);
    } else if (e.type === 'crashed') {
      this.audio.crash();
      this.flash(l.reason, 'bad', 3000);
      this.goTransition(2500, () => this.finish(false, l.reason));
    } else if (e.type === 'liftoff') {
      this.flash('離陸！ 高度を上げて軌道へ', '', 2500);
    } else if (e.type === 'notready') {
      if (performance.now() > this.msgUntil) this.flash('まだデータ回収が終わっていない', 'warn', 1200);
    } else if (e.type === 'orbit') {
      this.audio.beep(1200, 0.08, 3);
      this.flash('軌道に復帰 — 母船へ戻ろう', '', 2500);
      this.goTransition(2000, () => {
        this.orbit = createReturn(this.orbit, l);
        this.stage = 'return';
        this.view = 'orbit';
        this.pred = null;
        this.applyStageUi();
      });
    }
  }

  goTransition(ms, next) {
    this.prevStage = this.stage;
    this.stage = 'transition';
    this.transitionAt = performance.now() + ms;
    this.nextStage = next;
  }

  finish(success, reason = '') {
    this.stage = 'result';
    const c = this.orbit.clock;
    const years = c.outside / 60 / HOURS_PER_YEAR;
    const fuel = this.view === 'lander' ? this.lander.fuel : this.orbit.fuel;
    let body;
    if (success) {
      let score = Math.max(0, 1100 - 18 * years - 2 * (100 - fuel));
      if (this.usedHold) score *= 0.9;
      score = Math.round(score);
      const rank = score >= 820 ? 'S' : score >= 700 ? 'A' : score >= 560 ? 'B' : 'C';
      this.onBest?.(MANEUVER_MISSION.id, score, rank);
      $('res-title').textContent = 'MISSION COMPLETE';
      body =
        `<div class="rank">${rank}</div><table class="stats">` +
        `<tr><td>スコア</td><td>${score}${this.usedHold ? '（速度保持使用 ×0.9）' : ''}</td></tr>` +
        `<tr><td>あなたの経過時間</td><td>${formatShipTime(c.ship)}</td></tr>` +
        `<tr><td>外の世界で過ぎた時間</td><td>${formatOutside(c.outside)}</td></tr>` +
        `<tr><td>推進剤の残り</td><td>${fuel.toFixed(0)} %</td></tr></table>` +
        `<p class="hint">あなたにとっては${formatShipTime(c.ship)}。母船で待っていた人には、${formatOutside(c.outside)}が過ぎていた。</p>`;
    } else {
      $('res-title').textContent = 'MISSION FAILED';
      const extra = this.lander?.landing && this.lander.phase === 'crashed'
        ? '<p class="hint">接地時：' + this.lander.landing.map((x) => `${x.label} ${x.value.toFixed(1)} ${x.unit}（${x.limit} 以下）`).join('、') + '</p>' : '';
      body = `<p class="reason">${reason}。</p>${extra}<p class="hint">外の世界では ${formatOutside(c.outside)} が過ぎていた。</p>`;
    }
    $('res-body').innerHTML = body;
    $('mmsg').textContent = '';
    $('result').classList.remove('hidden');
    $('mtouch').classList.add('hidden');
  }

  // ---------------- 描画 ----------------
  layoutViewport() {
    const panel = $('mpanel').getBoundingClientRect();
    const touch = $('mtouch');
    const bottom = !touch.classList.contains('hidden') ? touch.getBoundingClientRect().top : this.h;
    const top = $('mclock').getBoundingClientRect().bottom + 4;
    const narrow = this.w < 720;
    if (narrow) {
      // 縦長: パネルの下からボタンの上まで
      const y = Math.max(top, panel.bottom + 4);
      return { x: 0, y, w: this.w, h: Math.max(160, bottom - y) };
    }
    return { x: 0, y: top, w: Math.max(200, panel.left - 8), h: Math.max(160, bottom - top) };
  }

  render(now) {
    const c = this.cv.getContext('2d');
    if (this.view === 'orbit') {
      this.orbitView.setViewport(this.layoutViewport());
      this.orbitView.draw(this.orbit, this.pred, now);
    } else {
      this.landerView.render(this.renderer, this.lander, now);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const touch = $('mtouch');
      const bottom = !touch.classList.contains('hidden') ? touch.getBoundingClientRect().top : this.h;
      const top = $('mclock').getBoundingClientRect().bottom + 30;
      // 縦長の画面ではレーダーを右上へ（下は案内とボタンで埋まる）
      const radarY = this.w < 720 ? top + 90 : Math.min(bottom - 110, this.h - 110); // 下に凡例3行ぶん
      this.landerView.drawHud(c, this.w, this.h, this.lander, { top, radarY, hold: this.holdOn, bannerY: top + 10 });
    }
  }

  updateUi(now) {
    const o = this.orbit;
    const c = o.clock;
    $('mc-ship').textContent = formatShipTime(c.ship);
    $('mc-out').textContent = formatOutside(c.outside);
    const dil = this.view === 'lander' ? dilationAt(R_PLANET) : o.dilation();
    $('mc-rate').textContent = `時間の遅れ ×${dil >= 100 ? Math.round(dil).toLocaleString() : dil.toFixed(2)}`;
    $('mc-rate').style.color = dil > 1000 ? BAD : dil > 10 ? WARN : OK;
    if (this.toastUntil && now > this.toastUntil) { $('mtoast').style.opacity = 0; $('mtoast').classList.add('gone'); this.toastUntil = 0; }

    // 右パネル（軌道パートのみ）
    const panel = $('mpanel');
    panel.classList.toggle('hidden', !this.isOrbitStage());
    if (this.isOrbitStage() && (!this.lastPanel || now - this.lastPanel > 100)) {
      this.lastPanel = now;
      const rel = o.relative();
      const cap = CAPTURE[o.target];
      const win = o.transferWindow();
      const p = this.pred;
      const rows = [];
      const row = (k, v, col = '') => rows.push(`<div class="row" style="color:${col}"><span class="k">${k}</span><span class="v">${v}</span></div>`);
      row('目標', o.target === 'planet' ? NAMES.planet : NAMES.mothership);
      row('距離', rel.dist.toFixed(3), rel.dist < cap.dist ? OK : '');
      row('相対速度', `${rel.speed.toFixed(3)}`, rel.speed < cap.rel ? OK : rel.dist < 0.5 ? WARN : '');
      if (p?.closest?.tau > 0.05 && p.closest.dist < 1) row('最接近', `${p.closest.dist.toFixed(3)}（${(p.closest.tau * REAL_SEC_PER_UNIT).toFixed(0)}秒後）`, p.closest.dist < cap.dist * 3 ? OK : '');
      if (p?.peri) row('近点', p.peri.r.toFixed(2), p.falls ? BAD : '');
      if (p?.apo) row('遠点', p.apo.r.toFixed(2));
      if (p?.falls) row('警告', 'このままだと落下', BAD);
      if (win) {
        const wait = (win.wait * REAL_SEC_PER_UNIT) - (win.burnTime * REAL_SEC_PER_UNIT) / 2;
        row('噴射タイミング', wait > 0 ? `あと ${wait.toFixed(0)} 秒` : '今！', wait < 3 ? OK : '');
        row('必要な噴射', `${win.dv < 0 ? '逆行' : '順行'} ${Math.abs(win.dv).toFixed(2)}`);
      }
      if (this.burnStart !== null) row('今回の噴射量', (o.dvUsed - this.burnStart).toFixed(3), WARN);
      row('推進剤', `${o.fuel.toFixed(0)} %`, o.fuel > 30 ? OK : o.fuel > 12 ? WARN : BAD);
      panel.innerHTML = rows.join('');
    }

    // 案内
    if (now > this.msgUntil && this.isOrbitStage()) {
      const rel = o.relative();
      const cap = CAPTURE[o.target];
      const win = o.transferWindow();
      let hint = '', cls = '';
      if (this.pred?.falls) { hint = 'このままだとブラックホールに落ちる！ 順行（P）に向けて噴射'; cls = 'bad'; }
      else if (rel.dist < 0.4) hint = rel.speed > cap.rel ? '目標逆行（T）に向けて噴射し、相対速度を落とそう' : '近づいて！ 目標の方へ少しだけ噴射';
      else if (win) hint = `${win.dv < 0 ? '逆行（R）' : '順行（P）'}に向けて待機。噴射タイミングが「今！」になったら W で、必要な噴射量まで`;
      else if (this.pred?.closest && this.pred.closest.dist > cap.dist * 3) hint = '予測線（緑）の「最接近」が小さくなるよう、少しずつ噴射して修正';
      else hint = '最接近まで待とう（「.」で時間加速）';
      const m = $('mmsg');
      if (m.textContent !== hint) { m.textContent = hint; m.className = cls; }
    }
  }
}
