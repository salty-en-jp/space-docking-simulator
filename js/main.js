import * as THREE from '../vendor/three.module.min.js';
import { Sim, SCENARIOS, PORT_Z, SPIN_LOCK_CAPTURE_RPM } from './sim.js';
import { Autopilot } from './autopilot.js';
import { createStation, createShip, createStars, createPlanet } from './models.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { readControls, onKey, bindTouchButtons, state as inputState } from './input.js';
import { Maneuver, MANEUVER_MISSION } from './maneuver/game.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / 120;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------------- 3D シーン ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000);

const SUN_DIR = new THREE.Vector3(1, 0.4, 0.5).normalize();
const sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x5577aa, 0x221100, 0.35));

const stars = createStars();
scene.add(stars);
const planet = createPlanet();
planet.position.set(0, -3900, -4600);
scene.add(planet);
// 太陽のにじみ
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.12, 'rgba(255,240,210,0.9)');
  g.addColorStop(0.4, 'rgba(255,200,140,0.15)');
  g.addColorStop(1, 'rgba(255,200,140,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.copy(SUN_DIR).multiplyScalar(8000);
  s.scale.setScalar(1400);
  scene.add(s);
}

const station = createStation();
scene.add(station);
const ship = createShip();
scene.add(ship);
// 船のライト（ポートを照らす）
const headlight = new THREE.SpotLight(0xe8f2ff, 60, 80, 0.35, 0.5, 1.5);
headlight.position.set(0, 0.5, 3);
ship.add(headlight);
const hlTarget = new THREE.Object3D();
hlTarget.position.set(0, 0, 30);
ship.add(hlTarget);
headlight.target = hlTarget;

// ---------------- UI ----------------
const hud = new HUD($('hud'), $('panel'));
const audio = new AudioEngine();

let maneuver = null; // マニューバ編（下で生成）

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hud.resize(w, h, Math.min(devicePixelRatio, 2));
  if (maneuver) maneuver.resize(w, h, Math.min(devicePixelRatio, 2));
}
addEventListener('resize', resize);
resize();

const best = (() => {
  try { return JSON.parse(localStorage.getItem('spinsync.best') || '{}'); } catch { return {}; }
})();
function saveBest(id, score, rank) {
  if (!best[id] || best[id].score < score) {
    best[id] = { score, rank };
    try { localStorage.setItem('spinsync.best', JSON.stringify(best)); } catch { /* 保存できなくても続行 */ }
  }
}

function buildMissionList() {
  const box = $('missions');
  box.innerHTML = '';
  const stars = { training: '★☆☆☆', standard: '★★☆☆', advanced: '★★★☆', extreme: '★★★★', dorsal: '★★☆☆', dorsalx: '★★★★' };
  for (const sc of Object.values(SCENARIOS)) {
    const b = document.createElement('button');
    b.className = 'mission';
    const bst = best[sc.id] ? `<span class="best">BEST ${best[sc.id].rank} ${best[sc.id].score}</span>` : '';
    b.innerHTML = `${bst}<div class="t">${sc.title}<span class="lv">${stars[sc.id]} ${sc.spinRpm} rpm</span></div><div class="d">${sc.briefing}</div>`;
    b.onclick = () => startMission(sc.id, false);
    box.appendChild(b);
  }
  // マニューバ編
  const mbox = $('mmissions');
  mbox.innerHTML = '';
  const mb = document.createElement('button');
  mb.className = 'mission';
  const mbest = best[MANEUVER_MISSION.id];
  mb.innerHTML = `${mbest ? `<span class="best">BEST ${mbest.rank} ${mbest.score}</span>` : ''}<div class="t">${MANEUVER_MISSION.title}<span class="lv">★★★☆ 軌道・着陸</span></div><div class="d">${MANEUVER_MISSION.briefing}</div>`;
  mb.onclick = startManeuver;
  mbox.appendChild(mb);
}

function startManeuver() {
  mode = 'maneuver';
  ['title', 'pause', 'result', 'help', 'flightui'].forEach((o) => show(o, false));
  maneuver.start();
}

// ---------------- ゲーム状態 ----------------
let mode = 'title'; // title | play | paused | result
let sim = new Sim(SCENARIOS.extreme);
let autopilot = null;
let usedAuto = false;
let isDemo = false;
let camMode = 0; // 0: 追従 1: コックピット 2: シネマ
const CAM_NAMES = ['追従カメラ', 'ドッキングカメラ', 'シネマカメラ'];
let acc = 0;
let msgUntil = 0;
let msgSticky = '';
let lastWarnBeep = 0;
let resultTimer = 0;
let prevLock = 'off';
let lastLockFlash = 0;

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function startMission(id, demo) {
  audio.start();
  sim = new Sim(SCENARIOS[id]);
  ship.userData.setDockType(sim.dockType);
  isDemo = demo;
  autopilot = demo ? new Autopilot() : null;
  usedAuto = demo;
  camMode = 0;
  acc = 0;
  resultTimer = 0;
  mode = 'play';
  ['title', 'pause', 'result', 'help'].forEach((o) => show(o, false));
  show('flightui', true);
  show('touch', isTouch);
  const [mNo, mName] = sim.sc.title.split(' ／ ');
  $('mission-name').innerHTML = `${mNo}<span class="mname"> ／ ${mName}</span>`;
  updateBadges();
  const toast = $('briefing-toast');
  toast.innerHTML = `<h4>${demo ? 'DEMO ／ 自動操縦' : 'BRIEFING'}</h4>${sim.sc.briefing}` +
    (demo ? '<br>［Z］で操縦を代わる ／ ［Esc］でメニュー' : '<br>［H］で操作一覧');
  toast.style.opacity = 1;
  toast.dataset.until = performance.now() + 9000;
  flash('', '');
}

function updateBadges() {
  const b = [];
  b.push(`<span class="opt">${CAM_NAMES[camMode]}</span>`);
  b.push(`<span class="opt">SAS ${inputState.sas ? 'ON' : 'OFF'}</span>`);
  b.push(`<span class="${inputState.spinLock ? 'lock' : 'opt'}">回転ロック ${inputState.spinLock ? 'ON' : 'OFF'}</span>`);
  if (sim.dockType === 'top') b.push(`<span class="${inputState.bodyFrame ? 'auto' : 'opt'}">操作: ${inputState.bodyFrame ? '機体基準' : 'ポート基準'}</span>`);
  if (autopilot) b.push('<span class="auto">AUTO</span>');
  const lockBtn = document.querySelector('#touch [data-key="KeyL"]');
  if (lockBtn) lockBtn.classList.toggle('on', inputState.spinLock);
  if (!audio.musicOn) b.push('<span>BGM OFF</span>');
  $('badges').innerHTML = b.join('');
}

function flash(text, cls = '', ms = 2500) {
  const m = $('msg');
  m.textContent = text;
  m.className = cls;
  msgUntil = performance.now() + ms;
}

function toTitle() {
  if (maneuver.active) maneuver.stop();
  mode = 'title';
  isDemo = false;
  ['pause', 'result', 'help', 'flightui'].forEach((o) => show(o, false));
  buildMissionList();
  show('title', true);
  // 背景用に限界ミッションをデモ飛行させておく
  sim = new Sim(SCENARIOS.extreme);
  ship.userData.setDockType(sim.dockType);
  autopilot = new Autopilot();
  camMode = 2;
}

function pause(on) {
  if (mode !== 'play' && mode !== 'paused') return;
  if (isDemo && on) { toTitle(); return; }
  mode = on ? 'paused' : 'play';
  show('pause', on);
}

function showResult() {
  mode = 'result';
  const r = sim.result;
  const body = $('res-body');
  if (sim.status === 'docked') {
    $('res-title').textContent = 'DOCKING COMPLETE';
    if (!usedAuto) saveBest(sim.sc.id, r.score, r.rank);
    const rows = r.checks.map((c) => `<tr><td>${c.label}</td><td>${c.value.toFixed(2)} ${c.unit} <span class="ok">／ ${c.limit}</span></td></tr>`).join('');
    body.innerHTML =
      `<div class="rank">${usedAuto ? 'AUTO' : r.rank}</div>` +
      `<table class="stats">` +
      `<tr><td>スコア</td><td>${r.score}${usedAuto ? '（自動操縦使用・記録なし）' : r.assist ? '（回転ロック使用 ×0.9）' : ''}</td></tr>` +
      `<tr><td>所要時間</td><td>${Math.floor(r.time / 60)}分${Math.floor(r.time % 60)}秒</td></tr>` +
      `<tr><td>推進剤の使用量</td><td>${Math.round(r.fuelUsed * 100)} %</td></tr>` +
      `<tr><td>船体</td><td>${Math.round(r.hull * 100)} %</td></tr>` +
      rows + `</table>`;
  } else {
    $('res-title').textContent = sim.status === 'crashed' ? 'MISSION FAILED' : 'MISSION ABORTED';
    let extra = '';
    if (sim.lastContact) {
      const bad = sim.lastContact.checks.filter((c) => !c.ok);
      if (bad.length) extra = '<p class="hint">最後の接触で許容範囲を超えていた項目：' + bad.map((c) => `${c.label}（${c.value.toFixed(2)} ${c.unit}）`).join('、') + '</p>';
    }
    body.innerHTML = `<p class="reason">${sim.reason}。</p>${extra}<p class="hint">ヒント：回転を完全に合わせてから、最後は W を軽く押すだけで十分です。</p>`;
  }
  $('msg').textContent = '';
  show('result', true);
  show('touch', false);
}

// ---------------- キー操作 ----------------
onKey('Escape', () => (mode === 'play' ? pause(true) : mode === 'paused' ? pause(false) : null));
onKey('KeyP', () => (mode === 'play' ? pause(true) : mode === 'paused' ? pause(false) : null));
onKey('KeyC', () => { if (mode === 'maneuver') return; camMode = (camMode + 1) % 3; updateBadges(); if (mode === 'play') flash(CAM_NAMES[camMode], '', 1200); });
onKey('KeyH', () => { if (mode === 'maneuver') return; if (mode === 'play') $('keyhelp').classList.toggle('hidden'); });
onKey('KeyT', () => { if (mode === 'maneuver') return; inputState.sas = !inputState.sas; updateBadges(); if (mode === 'play') flash(`SAS ${inputState.sas ? 'ON' : 'OFF'}`, '', 1200); });
onKey('KeyL', () => {
  if (mode === 'maneuver') return;
  inputState.spinLock = !inputState.spinLock;
  updateBadges();
  if (mode === 'play') flash(inputState.spinLock ? `回転ロック ON（回転差 ${SPIN_LOCK_CAPTURE_RPM} rpm 以内で作動）` : '回転ロック OFF', '', 1800);
});
onKey('KeyV', () => {
  if (mode !== 'play' || sim.dockType !== 'top') return;
  inputState.bodyFrame = !inputState.bodyFrame;
  updateBadges();
  flash(inputState.bodyFrame ? '操作: 機体基準（W で機首方向、→ でステーションと同じ向きに回転）' : '操作: ポート基準（W でポート方向、Q/E で回転）', 'warn', 2500);
});
onKey('KeyM', () => { audio.start(); audio.setMusic(!audio.musicOn); updateBadges(); });
onKey('KeyZ', () => {
  if (mode !== 'play') return;
  if (autopilot) { autopilot = null; isDemo = false; flash('手動操縦に切り替え', 'warn', 1500); }
  else { autopilot = new Autopilot(); usedAuto = true; flash('オートパイロット ON', 'warn', 1500); }
  updateBadges();
});
bindTouchButtons($('touch'));

$('btn-demo').onclick = () => startMission('extreme', true);
$('btn-help').onclick = () => show('help', true);
$('btn-help-close').onclick = () => show('help', false);
$('btn-resume').onclick = () => (maneuver.active ? maneuver.setPaused(false) : pause(false));
$('btn-restart').onclick = () => (maneuver.active ? maneuver.restart() : startMission(sim.sc.id, false));
$('btn-retry').onclick = () => (maneuver.active ? maneuver.restart() : startMission(sim.sc.id, false));
$('btn-menu').onclick = toTitle;
$('btn-menu2').onclick = toTitle;

// ---------------- カメラ ----------------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
function updateCamera() {
  // f: ドッキングポートの向き、u: その画面上方向（機首ポートなら機首と上面、上部ポートなら上面と機首）
  const f = sim.dockDir(), u = sim.dockUp();
  ship.visible = true;
  if (camMode === 0) {
    // 船の少し上・後ろから機首方向と平行に見る（船は画面下寄り、ポートは中央）
    // 上部ポートは機体が横たわって視界をふさぐので、少し遠めから
    const top = sim.dockType === 'top';
    camPos.copy(sim.pos).addScaledVector(u, top ? 8 : 6).addScaledVector(f, top ? -17 : -14);
    camLook.copy(camPos).addScaledVector(f, 40);
    camera.up.copy(u);
  } else if (camMode === 1) {
    camPos.copy(sim.dockPoint()).addScaledVector(f, 0.3).addScaledVector(u, 0.35);
    camLook.copy(camPos).addScaledVector(f, 10);
    camera.up.copy(u);
    ship.visible = false;
  } else {
    const W = sim.wobbleQuat(sim.t);
    camPos.set(34, 16, PORT_Z + 36).applyQuaternion(W);
    camLook.copy(sim.portPos(sim.t)).lerp(sim.pos, 0.5);
    camera.up.set(0, 1, 0);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateMatrixWorld();
}

// ---------------- メインループ ----------------
let last = performance.now();
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'maneuver') {
    maneuver.frame(dtReal, now);
    requestAnimationFrame(frame);
    return;
  }

  if (mode === 'play' || mode === 'title' || mode === 'result') {
    const manual = mode === 'play' ? readControls() : null;
    acc += dtReal;
    while (acc >= DT) {
      let ctl = manual;
      if (autopilot || !ctl) ctl = autopilot ? autopilot.update(sim) : { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sas: true };
      sim.step(DT, ctl);
      acc -= DT;
    }
    // タイトル画面の背景デモは終わったら繰り返す
    if (mode === 'title' && sim.status !== 'flying' && sim.t > 160) {
      sim = new Sim(SCENARIOS.extreme);
      autopilot = new Autopilot();
    }
  }

  // イベント処理
  for (const e of sim.events.splice(0)) {
    if (mode !== 'play') continue;
    if (e.type === 'dock') {
      audio.clunk();
      audio.triumph();
      flash('DOCKED', 'big', 5000);
      resultTimer = now + 4000;
    } else if (e.type === 'bump') {
      audio.clunk();
      audio.beep(660, 0.1, 2);
      flash(`弾かれた：${e.reasons.join('・')}が許容範囲外`, 'warn', 3500);
    } else if (e.type === 'crashed' || e.type === 'failed') {
      audio.crash();
      flash(sim.reason, 'bad', 4000);
      resultTimer = now + 2500;
    }
  }
  if (mode === 'play' && resultTimer && now > resultTimer) {
    resultTimer = 0;
    if (isDemo) { startMission('extreme', true); } else showResult();
  }

  const tm = sim.telemetry();
  // 回転ロックが作動した瞬間を知らせる（微調整で何度も切り替わるときは鳴らしすぎない）
  if (mode === 'play' && tm.spinLock === 'engaged' && prevLock !== 'engaged' && now - lastLockFlash > 4000) {
    audio.beep(1500, 0.05, 2);
    flash('回転ロック作動：ステーションの回転を保持中', '', 1800);
    lastLockFlash = now;
  }
  prevLock = tm.spinLock;

  // 案内メッセージ
  if (mode === 'play' && sim.status === 'flying' && now > msgUntil) {
    const tol = sim.sc.tol;
    let hint = '', cls = '';
    if (tm.axial < 12 && tm.closing > tol.closing * 1.2) {
      hint = '接近速度が速すぎる！ S で減速'; cls = 'bad';
      if (now - lastWarnBeep > 700) { audio.beep(1200, 0.06); lastWarnBeep = now; }
    } else if (tm.axial < 6 && Math.abs(tm.dSpinRpm) > tol.spin) {
      hint = '回転が合っていない！ 一度 S で離れよう'; cls = 'warn';
    } else if (sim.sc.id === 'training' && !autopilot) {
      if (tm.align > tol.align) hint = '① 矢印キーで照準（○）をポートの◇に向けよう';
      else if (tm.lateral > tol.lateral) hint = '② A/D・R/F で横に動いてゲートの中心へ（X で横流れを止める）';
      else if (Math.abs(tm.dSpinRpm) > tol.spin) hint = `③ ${tm.dSpinRpm < 0 ? 'Q' : 'E'} を押して回転を合わせよう`;
      else if (Math.abs(tm.phase) > tol.phase) hint = `④ Shift + ${tm.phase > 0 ? 'Q' : 'E'} でオレンジのマーカーを真上に`;
      else if (tm.closing < 0.05) hint = '⑤ W を軽く押して、ゆっくり前進';
      else hint = 'そのまま…まっすぐ…';
    }
    const m = $('msg');
    if (hint !== msgSticky || m.className !== cls) {
      m.textContent = hint;
      m.className = cls;
      msgSticky = hint;
    }
  }
  const toast = $('briefing-toast');
  if (toast.dataset.until && now > +toast.dataset.until) { toast.style.opacity = 0; delete toast.dataset.until; }

  // 描画更新
  station.quaternion.copy(sim.stationQuat(sim.t));
  station.userData.update(sim.t);
  ship.position.copy(sim.pos);
  ship.quaternion.copy(sim.q);
  ship.userData.setThrust(sim.accBody, sim.angBody);
  planet.rotation.y += dtReal * 0.002;
  updateCamera();
  renderer.render(scene, camera);
  const touchEl = $('touch');
  const touchTop = isTouch && !touchEl.classList.contains('hidden') ? touchEl.getBoundingClientRect().top : innerHeight;
  hud.draw(sim, tm, camera, { visible: mode === 'play' || mode === 'paused', bottom: touchTop, spinKeys: sim.spinKeys(inputState.bodyFrame) });

  // 音
  const tension = sim.status === 'flying' ? Math.min(1, Math.max(0, 1 - tm.axial / 60)) * 0.7 + (sim.sc.timeLimit ? 0.3 : 0) : sim.status === 'docked' ? 0 : 0.2;
  const thrust = mode === 'play' ? (sim.accBody.length() / 0.5 + sim.angBody.length() / 0.5) : 0;
  audio.update(tension, thrust);

  requestAnimationFrame(frame);
}

maneuver = new Maneuver({ renderer, audio, isTouch, onBest: saveBest });
resize();
toTitle();
requestAnimationFrame(frame);

// デバッグ用（ブラウザのコンソールから参照できる）
window.__spinsync = { get sim() { return sim; }, startMission, startManeuver, maneuver };
