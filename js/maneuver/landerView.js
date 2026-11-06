// 着陸パートの3D表示と計器
import * as THREE from '../../vendor/three.module.min.js';
import { createShip, createStars } from '../models.js';
import { PAD_R, LIMITS, ASCENT_ALT, ASCENT_VY, COLLECT_SEC } from './lander.js';

const OK = '#7CFFB2', WARN = '#FFB347', BAD = '#FF5C5C', DIM = 'rgba(124,255,178,0.4)';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#7d8a99';
  x.fillRect(0, 0, 512, 512);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2500; i++) {
    const v = 100 + rnd() * 70;
    x.fillStyle = `rgba(${v},${v + 10},${v + 25},0.25)`;
    x.beginPath(); x.arc(rnd() * 512, rnd() * 512, 2 + rnd() * 14, 0, Math.PI * 2); x.fill();
  }
  // 氷の割れ目
  x.strokeStyle = 'rgba(40,50,70,0.35)';
  for (let i = 0; i < 40; i++) {
    x.lineWidth = 0.5 + rnd() * 1.5;
    x.beginPath();
    let px = rnd() * 512, py = rnd() * 512;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (rnd() - 0.5) * 80; py += (rnd() - 0.5) * 80; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function diskTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(256, 256, 60, 256, 256, 256);
  g.addColorStop(0, 'rgba(255,245,220,0)');
  g.addColorStop(0.24, 'rgba(255,240,210,1)');
  g.addColorStop(0.45, 'rgba(255,180,90,0.8)');
  g.addColorStop(0.8, 'rgba(200,90,40,0.25)');
  g.addColorStop(1, 'rgba(160,60,30,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

export class LanderView {
  constructor() {
    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color(0x05070d);
    s.fog = new THREE.Fog(0x0b1018, 900, 5200);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 30000);

    const stars = createStars();
    stars.material.fog = false;
    s.add(stars);

    // 空のブラックホール（真っ黒な円と、ほぼ真横から見た降着円盤）
    const bh = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), new THREE.MeshBasicMaterial({
      map: diskTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    // グループの +Z が見る人の方を向く。円盤はほぼ真横から（少しだけ上から）見える角度
    disk.rotation.x = -Math.PI / 2 + 0.14;
    disk.rotation.y = 0.18;
    bh.add(disk);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(620, 48), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    bh.add(hole);
    bh.position.set(-3200, 1100, -9000);
    bh.lookAt(0, 0, 0);
    s.add(bh);
    this.bh = bh;

    s.add(new THREE.HemisphereLight(0x6f8fbf, 0x1a1410, 0.6));
    const disklight = new THREE.DirectionalLight(0xffd2a0, 2.2);
    disklight.position.copy(bh.position).normalize().multiplyScalar(100);
    s.add(disklight);

    // 地面とパッド
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.85, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2;
    s.add(ground);
    const pad = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_R - 1.5, PAD_R, 64), new THREE.MeshBasicMaterial({ color: 0x7cffb2 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    pad.add(ring);
    for (const [w, h] of [[24, 1.2], [1.2, 24]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x7cffb2 }));
      bar.rotation.x = -Math.PI / 2;
      bar.position.y = 0.06;
      pad.add(bar);
    }
    this.padLights = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      l.position.set(Math.cos(a) * (PAD_R + 1), 0.35, Math.sin(a) * (PAD_R + 1));
      pad.add(l);
      this.padLights.push(l);
    }
    // 目印のビーコン（遠くから見える光の柱）
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 400, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7cffb2, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 200;
    pad.add(beam);
    s.add(pad);

    // 船（機首 = -z 方向に向ける）
    this.ship = createShip();
    this.ship.userData.setDockType('nose');
    s.add(this.ship);
    // 影（真下の地面に暗い円）
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(3.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.08;
    s.add(this.shadow);
    // 噴射の光
    this.flame = new THREE.PointLight(0x9fd8ff, 0, 60, 2);
    s.add(this.flame);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(renderer, l, now) {
    const [x, y, z] = l.pos;
    this.ship.position.set(x, y, z);
    const u = new THREE.Vector3(...l.up());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    this.ship.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.ship.userData.setThrust(new THREE.Vector3(0, l.throttle, 0), new THREE.Vector3());
    this.shadow.position.set(x, 0.08, z);
    const alt = Math.max(0, l.alt());
    this.shadow.scale.setScalar(1 + alt / 60);
    this.shadow.material.opacity = Math.max(0.05, 0.5 - alt / 400);
    this.flame.position.set(x, y - 1.5, z);
    this.flame.intensity = l.throttle * 40;
    const on = Math.floor(now / 120) % 8;
    this.padLights.forEach((p, i) => p.material.color.setHex(i === on ? 0xffffff : 0x9fffc8));

    const cam = this.camera;
    const back = 16 + Math.min(40, alt * 0.05);
    cam.position.set(x, Math.max(3, y + 5 + Math.min(30, alt * 0.04)), z + back);
    cam.lookAt(x, y - 2 - Math.min(20, alt * 0.03), z - 14);
    renderer.render(this.scene, cam);
  }

  // 計器（2Dキャンバスに描く）
  drawHud(c, w, h, l, opts) {
    c.clearRect(0, 0, w, h);
    c.font = '13px "Share Tech Mono", ui-monospace, monospace';
    const vy = l.vel[1];
    const vh = l.hSpeed();
    const lvl = (v, lim) => (v <= lim ? OK : v <= lim * 2.5 ? WARN : BAD);
    const rows = [
      ['高度', `${Math.max(0, l.alt()).toFixed(0)} m`, OK],
      [l.phase === 'ascent' ? '上昇速度' : '降下速度', `${(l.phase === 'ascent' ? vy : -vy).toFixed(1)} m/s`, l.phase === 'ascent' ? (vy >= ASCENT_VY ? OK : WARN) : lvl(Math.max(0, -vy), LIMITS.vy)],
      ['水平速度', `${vh.toFixed(1)} m/s`, l.phase === 'ascent' ? OK : lvl(vh, LIMITS.vh)],
      ['パッドまで', `${l.padDist().toFixed(0)} m`, l.padDist() <= PAD_R ? OK : WARN],
      ['傾き', `${l.tiltDeg().toFixed(1)}°`, lvl(l.tiltDeg(), LIMITS.tiltDeg)],
      ['推進剤', `${l.fuel.toFixed(0)} %`, l.fuel > 20 ? OK : l.fuel > 8 ? WARN : BAD],
    ];
    const x0 = 16, y0 = opts.top;
    c.fillStyle = 'rgba(4,14,10,0.72)';
    c.fillRect(x0 - 8, y0 - 18, 190, rows.length * 22 + 14);
    rows.forEach(([k, v, col], i) => {
      c.fillStyle = col;
      c.font = '12px "Zen Kaku Gothic New", sans-serif';
      c.fillText(k, x0, y0 + i * 22);
      c.font = '15px "Share Tech Mono", monospace';
      c.textAlign = 'right';
      c.fillText(v, x0 + 172, y0 + i * 22);
      c.textAlign = 'left';
    });

    // 推力バー
    const bx = x0, by = y0 + rows.length * 22 + 8;
    c.strokeStyle = DIM;
    c.strokeRect(bx, by, 172, 8);
    c.fillStyle = l.holdActive ? '#9fd8ff' : WARN;
    c.fillRect(bx, by, 172 * l.throttle, 8);
    c.fillStyle = l.holdActive ? '#9fd8ff' : DIM;
    c.font = '11px "Zen Kaku Gothic New", sans-serif';
    c.fillText(l.holdActive ? '推力（速度保持 作動中）' : opts.hold ? '推力（速度保持 待機）' : '推力', bx, by + 22);

    // ミニレーダー（真上から見たパッドの位置と速度）
    const R = 56, rx = w - R - 20, ry = opts.radarY;
    c.strokeStyle = DIM;
    c.beginPath(); c.arc(rx, ry, R, 0, Math.PI * 2); c.stroke();
    const range = Math.max(80, Math.min(600, l.padDist() * 1.3));
    const sc = R / range;
    c.beginPath(); c.arc(rx, ry, PAD_R * sc, 0, Math.PI * 2); c.stroke();
    // 自船を中心に、パッドの相対位置を描く（上が前方 = -z）
    const px = rx - l.pos[0] * sc, py = ry + l.pos[2] * sc;
    const clampR = (dx, dy) => { const d = Math.hypot(dx, dy); return d > R ? [dx * R / d, dy * R / d] : [dx, dy]; };
    const [pdx, pdy] = clampR(px - rx, py - ry);
    c.fillStyle = OK;
    c.beginPath(); c.arc(rx + pdx, ry + pdy, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = WARN;
    c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + l.vel[0] * sc * 4, ry + l.vel[2] * sc * 4); c.stroke();
    c.fillStyle = WARN;
    c.beginPath(); c.arc(rx, ry, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = DIM;
    c.fillText(`パッド位置（半径 ${range.toFixed(0)} m）`, rx - R, ry - R - 8);

    // データ回収
    if (l.phase === 'surface') {
      const W = Math.min(360, w - 40), X = (w - W) / 2, Y = opts.bannerY;
      c.strokeStyle = OK;
      c.strokeRect(X, Y, W, 12);
      c.fillStyle = OK;
      c.fillRect(X, Y, W * l.collect, 12);
      c.font = '14px "Zen Kaku Gothic New", sans-serif';
      c.textAlign = 'center';
      c.fillText(l.collect < 1 ? `データ回収中… ${Math.floor(l.collect * COLLECT_SEC)} / ${COLLECT_SEC} 分` : '回収完了！ W で離陸', w / 2, Y - 10);
      c.textAlign = 'left';
    }
    if (l.phase === 'ascent') {
      c.font = '13px "Zen Kaku Gothic New", sans-serif';
      c.fillStyle = OK;
      c.textAlign = 'center';
      c.fillText(`軌道へ：高度 ${ASCENT_ALT} m・上昇速度 ${ASCENT_VY} m/s 以上`, w / 2, opts.bannerY);
      c.textAlign = 'left';
    }
  }
}
