// 3Dモデル（ステーション・宇宙船・惑星・星空）。すべてオリジナルデザイン。
import * as THREE from '../vendor/three.module.min.js';
import { PORT_Z, HUB_R, HUB_BACK, RING_R } from './sim.js';

const hull = (color = 0xc9ccd1, rough = 0.7, metal = 0.3) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const glow = (color) => new THREE.MeshBasicMaterial({ color });

// ---------------- ステーション ----------------
export function createStation() {
  const g = new THREE.Group();
  const white = hull(0xd8d8d2, 0.75, 0.2);
  const grey = hull(0x8d9096, 0.6, 0.5);
  const dark = hull(0x3a3d44, 0.5, 0.6);
  const gold = hull(0xb8913a, 0.35, 0.8);

  // 居住リング
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 1.6, 12, 96), grey);
  g.add(ring);
  const N = 12;
  const windowMat = glow(0xffd9a0);
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const mod = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 5.5), i % 3 === 0 ? gold : white);
    mod.add(body);
    // 窓の明かり
    for (let k = -2; k <= 2; k++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), windowMat);
      w.position.set(k * 1.2, 0.6, 2.76);
      mod.add(w);
    }
    // 放熱板
    const rad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 2.4), dark);
    rad.position.set(0, 2.4, -1);
    mod.add(rad);
    mod.position.set(Math.cos(ang) * RING_R, Math.sin(ang) * RING_R, 0);
    mod.rotation.z = ang + Math.PI / 2;
    g.add(mod);
  }
  // スポーク
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const len = RING_R - HUB_R;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, len, 10), grey);
    sp.position.set(Math.cos(ang) * (HUB_R + len / 2), Math.sin(ang) * (HUB_R + len / 2), 0);
    sp.rotation.z = ang - Math.PI / 2;
    g.add(sp);
  }
  // 中央ハブ
  const hubLen = PORT_Z - HUB_BACK;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, hubLen, 32), white);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = (PORT_Z + HUB_BACK) / 2;
  g.add(hub);
  for (let z = HUB_BACK + 3; z < PORT_Z - 1; z += 5) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(HUB_R + 0.05, 0.18, 6, 40), dark);
    band.position.z = z;
    g.add(band);
  }
  // ドッキングポート面
  const face = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 40), dark);
  face.position.z = PORT_Z + 0.01;
  g.add(face);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.35, 10, 40), gold);
  collar.position.z = PORT_Z + 0.2;
  g.add(collar);
  const hatch = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), hull(0x22252b, 0.4, 0.7));
  hatch.position.z = PORT_Z + 0.03;
  g.add(hatch);
  // 位置合わせマーカー（+Y方向がオレンジ、他は白）
  const markerOrange = glow(0xff8a1f);
  const markerWhite = glow(0xe8f0ff);
  const mk = (w, h, x, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, PORT_Z + 0.06);
    g.add(m);
  };
  mk(0.35, 1.1, 0, 3.35, markerOrange);
  mk(0.25, 0.8, 0, -3.35, markerWhite);
  mk(0.8, 0.25, 3.35, 0, markerWhite);
  mk(0.8, 0.25, -3.35, 0, markerWhite);
  mk(0.12, 1.6, 0, 0, markerWhite);
  mk(1.6, 0.12, 0, 0, markerWhite);

  // 進入誘導灯（点滅させる）
  const approachLights = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), glow(0x9fd8ff));
    l.position.set(Math.cos(ang) * 3.7, Math.sin(ang) * 3.7, PORT_Z + 0.15);
    g.add(l);
    approachLights.push(l);
  }
  // 航行灯
  const beacons = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), glow(i % 2 ? 0xff3030 : 0x30ff60));
    b.position.set(Math.cos(ang) * (RING_R + 2), Math.sin(ang) * (RING_R + 2), 0);
    g.add(b);
    beacons.push(b);
  }
  // 太陽電池パネル（ハブ後方）
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: 0.3, metalness: 0.8, emissive: 0x050a18 });
  for (let i = 0; i < 2; i++) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 6), grey);
    arm.position.set(0, 0, HUB_BACK - 2);
    arm.rotation.z = i * Math.PI / 2;
    g.add(arm);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(5, 11, 0.1), panelMat);
      const along = s * 9.5;
      if (i === 0) p.position.set(0, along, HUB_BACK - 2);
      else { p.position.set(along, 0, HUB_BACK - 2); p.rotation.z = Math.PI / 2; }
      g.add(p);
    }
  }
  g.userData.update = (t) => {
    approachLights.forEach((l, i) => {
      const on = Math.floor(t * 8) % 8 === i;
      l.material.color.setHex(on ? 0xffffff : 0x305070);
    });
    const blink = Math.sin(t * 4) > 0.6;
    beacons.forEach((b) => (b.visible = blink));
  };
  return g;
}

// ---------------- 宇宙船（機首 = ローカル +Z） ----------------
export function createShip() {
  const g = new THREE.Group();
  const white = hull(0xe6e6e2, 0.65, 0.2);
  const dark = hull(0x2e3036, 0.5, 0.5);
  const accent = hull(0x9a3b2a, 0.6, 0.3);

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 5.2), white);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 1.2, 8), white);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 3.1;
  g.add(nose);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 8, 24), dark);
  collar.position.z = 3.2;
  g.add(collar);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.25, 3.2), accent);
  stripe.position.set(0, 0.2, 0.3);
  g.add(stripe);
  // 窓
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.6), hull(0x111418, 0.1, 0.9));
  win.position.set(0, 0.75, 2.2);
  win.rotation.x = -0.4;
  g.add(win);
  // 翼（短いデルタ）
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(3.2, -1.6); wingShape.lineTo(3.2, -2.6); wingShape.lineTo(0, -2.4);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: false });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, white);
    w.rotation.x = Math.PI / 2;
    w.scale.x = s;
    w.position.set(s * 1.2, -0.5, 1.0);
    g.add(w);
  }
  // 垂直尾翼
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 1.6), white);
  fin.position.set(0, 1.4, -2.0);
  g.add(fin);
  // エンジン
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.8, 12), dark);
    e.rotation.x = Math.PI / 2;
    e.position.set(s * 0.7, -0.1, -2.9);
    g.add(e);
  }
  // 姿勢マーカー（上面、ステーションのオレンジに合わせる目印）
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 1.4), glow(0xff8a1f));
  tick.position.set(0, 0.88, 0.9);
  g.add(tick);

  // 上部ドッキングポート（上部ポートのミッションでだけ表示。重心の真上）
  const topPort = new THREE.Group();
  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.3, 20), white);
  adapter.position.y = 0.95;
  topPort.add(adapter);
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.16, 8, 28), dark);
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = 1.1;
  topPort.add(topRing);
  // 機首側を示すオレンジの目印（ステーションのマーカーと合わせる側）
  const topTick = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.7), glow(0xff8a1f));
  topTick.position.set(0, 1.12, 1.35);
  topPort.add(topTick);
  topPort.visible = false;
  g.add(topPort);
  g.userData.setDockType = (type) => {
    const top = type === 'top';
    topPort.visible = top;
    fin.visible = !top;   // 上面が結合面になるので垂直尾翼は無し
    tick.visible = !top;
  };

  // RCS噴射エフェクト
  const puffTex = makePuffTexture();
  const puffMat = new THREE.SpriteMaterial({ map: puffTex, color: 0xcfe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const mkPuff = (x, y, z) => {
    const s = new THREE.Sprite(puffMat);
    s.position.set(x, y, z);
    s.scale.setScalar(0.9);
    s.visible = false;
    g.add(s);
    return s;
  };
  // RCSスラスタの配置（船のローカル座標: +X = 左舷, -X = 右舷, +Y = 上, +Z = 機首）
  // ガスを噴いた側と反対向きに船が押される。
  const T = {
    leftFwd: mkPuff(1.65, 0, 1.6),   leftAft: mkPuff(1.65, 0, -1.6),
    rightFwd: mkPuff(-1.65, 0, 1.6), rightAft: mkPuff(-1.65, 0, -1.6),
    topFwd: mkPuff(0, 1.25, 1.6),    topAft: mkPuff(0, 1.25, -1.6),
    botFwd: mkPuff(0, -1.25, 1.6),   botAft: mkPuff(0, -1.25, -1.6),
    // ロール用（上下の角から横向きに噴く）
    topLeft: mkPuff(1.55, 0.95, 0),  topRight: mkPuff(-1.55, 0.95, 0),
    botLeft: mkPuff(1.55, -0.95, 0), botRight: mkPuff(-1.55, -0.95, 0),
    aftL: mkPuff(0.7, -0.1, -3.7),   aftR: mkPuff(-0.7, -0.1, -3.7),
    noseL: mkPuff(1.1, 0.6, 3.3),    noseR: mkPuff(-1.1, 0.6, 3.3),
  };
  const fire = new Set();
  g.userData.setThrust = (accBody, angBody) => {
    const th = 0.05, ta = 0.02;
    fire.clear();
    const on = (...names) => names.forEach((n) => fire.add(n));
    // 並進: 進みたい向きと反対側から噴く
    if (accBody.x > th) on('rightFwd', 'rightAft');        // 左へ
    if (accBody.x < -th) on('leftFwd', 'leftAft');         // 右へ
    if (accBody.y > th) on('botFwd', 'botAft');            // 上へ
    if (accBody.y < -th) on('topFwd', 'topAft');           // 下へ
    if (accBody.z > th) on('aftL', 'aftR');                // 前へ
    if (accBody.z < -th) on('noseL', 'noseR');             // 後ろへ
    // ヨー: +Y 軸まわり正 = 機首が左へ → 機首を左へ押す(右前で噴く)＋尾部を右へ押す(左後ろで噴く)
    if (angBody.y > ta) on('rightFwd', 'leftAft');
    if (angBody.y < -ta) on('leftFwd', 'rightAft');
    // ピッチ: +X 軸まわり正 = 機首が下へ → 上前＋下後ろで噴く
    if (angBody.x > ta) on('topFwd', 'botAft');
    if (angBody.x < -ta) on('botFwd', 'topAft');
    // ロール: +Z 軸まわり正 = 上面が右舷側へ → 上面は左舷側で噴く、下面は右舷側で噴く
    if (angBody.z > ta) on('topLeft', 'botRight');
    if (angBody.z < -ta) on('topRight', 'botLeft');
    for (const [name, p] of Object.entries(T)) {
      p.visible = fire.has(name);
      if (p.visible) p.scale.setScalar(0.6 + Math.random() * 0.6);
    }
  };
  return g;
}

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(200,225,255,0.6)');
  gr.addColorStop(1, 'rgba(200,225,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------- 星空 ----------------
export function createStars() {
  const n = 5000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(9000);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.5 + Math.random() * 0.5;
    const tint = Math.random();
    col.set([b * (tint > 0.8 ? 1 : 0.85), b * 0.9, b * (tint < 0.2 ? 0.8 : 1)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
}

// ---------------- 惑星 ----------------
export function createPlanet() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  // 海
  x.fillStyle = '#1d3b5c';
  x.fillRect(0, 0, 1024, 512);
  // 大陸（乱数の円を重ねたブロブ）
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 9; k++) {
    const cx = rnd() * 1024, cy = 80 + rnd() * 350, R = 40 + rnd() * 90;
    for (let j = 0; j < 60; j++) {
      const a = rnd() * Math.PI * 2, r = rnd() * R;
      x.fillStyle = `rgba(${70 + rnd() * 50},${85 + rnd() * 40},${55 + rnd() * 25},0.45)`;
      x.beginPath();
      x.arc(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r, 10 + rnd() * 30, 0, Math.PI * 2);
      x.fill();
    }
  }
  // 雲の帯
  for (let k = 0; k < 700; k++) {
    x.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.2})`;
    x.beginPath();
    x.ellipse(rnd() * 1024, rnd() * 512, 20 + rnd() * 80, 3 + rnd() * 8, 0, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 96, 64),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 })
  );
  g.add(planet);
  // 大気のふち
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(3090, 96, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0.4, 0.5).normalize() } },
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vW=(modelMatrix*vec4(position,1.)).xyz;
          gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.); }`,
      fragmentShader: `
        uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 v = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(v, vN)), 3.0);
          float lit = clamp(dot(-vN, sunDir)*0.7+0.4, 0.05, 1.0);
          gl_FragColor = vec4(vec3(0.35,0.6,1.0)*rim*lit*1.6, rim*lit); }`,
    })
  );
  g.add(atmo);
  g.userData.planet = planet;
  return g;
}
