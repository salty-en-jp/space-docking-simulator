// マニューバ編: 時間の遅れの数値と、ミッション全体を自動操縦で完了できるかの確認
import { dilationAt, kerrUt, R_KERR_PLANET, TARGET_FACTOR, iscoRadius } from '../js/maneuver/relativity.js';
import { R_PLANET, R_MOTHER, REAL_SEC_PER_UNIT } from '../js/maneuver/orbit.js';
import { createOutbound, createLanding, createReturn, landerClockTick, formatShipTime, formatOutside } from '../js/maneuver/mission.js';
import { OrbitGuide, LanderGuide } from '../js/maneuver/guidance.js';
import { LanderSim, radarOffsets } from '../js/maneuver/lander.js';

let failed = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!cond) failed++; };

// ---- 時間の遅れ ----
check('planet orbit: 1 hour = 7 years', Math.abs(dilationAt(R_PLANET) / TARGET_FACTOR - 1) < 1e-6, `×${dilationAt(R_PLANET).toFixed(0)}`);
check('planet orbit is outside ISCO', R_KERR_PLANET > iscoRadius(), `r=${R_KERR_PLANET} isco=${iscoRadius()}`);
check('mothership barely dilated', dilationAt(R_MOTHER) < 1.1, `×${dilationAt(R_MOTHER).toFixed(3)}`);
check('Schwarzschild-like limit sanity (r=10, a≈1)', Math.abs(kerrUt(10) - 1.181) < 0.01, `u^t=${kerrUt(10).toFixed(3)}`);

// ---- 着陸レーダーの向き（画面: 右 = +, 下 = +, 上 = 前方） ----
{
  const l = new LanderSim({ fuel: 100 });
  l.pos = [0, 200, 100]; l.vel = [0, -10, -5]; // パッドは前方100m、前へ進んでいる
  let ro = radarOffsets(l);
  check('radar: pad ahead is drawn up', ro.pad[1] < 0 && Math.abs(ro.pad[0]) < 1e-9, `pad=${ro.pad}`);
  check('radar: moving toward pad points the same way', ro.vel[1] < 0, `vel=${ro.vel}`);
  check('radar: predicted landing ahead', ro.landing && ro.landing[1] < 0, `landing=${ro.landing}`);
  l.pos = [50, 200, 0];
  ro = radarOffsets(l);
  check('radar: pad to the left is drawn left', ro.pad[0] < 0, `pad=${ro.pad}`);
  // 前へ傾けると推力は前方（画面の上）を押し、右へ傾けると右を押す
  for (let i = 0; i < 60; i++) l.step(1 / 60, { thrust: 1, tx: 1, tz: 1, hold: false });
  ro = radarOffsets(l);
  check('radar: tilt forward+right pushes up+right', ro.push[0] > 0 && ro.push[1] < 0, `push=${ro.push.map((v) => v.toFixed(2))}`);
}

// ---- ミッション全体 ----
const dtReal = 1 / 60;
let o = createOutbound();
const g = new OrbitGuide();
let realSec = 0;
while (o.status === 'flying' && realSec < 600) {
  const ctl = g.update(o);
  const warp = ctl.thrust > 0 ? 1 : g.warp;
  o.step(dtReal / REAL_SEC_PER_UNIT * warp, dtReal, ctl);
  realSec += dtReal;
}
check('outbound: reached the planet', o.status === 'captured', `status=${o.status} fuel=${o.fuel.toFixed(1)}% real=${realSec.toFixed(0)}s ship=${formatShipTime(o.clock.ship)} outside=${formatOutside(o.clock.outside)} ${o.reason}`);

const l = createLanding(o);
const lg = new LanderGuide();
let t = 0;
while (!['orbit', 'crashed'].includes(l.phase) && t < 600) {
  l.step(1 / 60, lg.update(l));
  landerClockTick(o.clock, 1 / 60);
  t += 1 / 60;
}
check('landing + ascent', l.phase === 'orbit', `phase=${l.phase} fuel=${l.fuel.toFixed(1)}% ${l.reason} landing=${(l.landing || []).map((c) => c.label + '=' + c.value.toFixed(2)).join(' ')}`);

let r = createReturn(o, l);
const g2 = new OrbitGuide();
realSec = 0;
while (r.status === 'flying' && realSec < 900) {
  const ctl = g2.update(r);
  const warp = ctl.thrust > 0 ? 1 : g2.warp;
  r.step(dtReal / REAL_SEC_PER_UNIT * warp, dtReal, ctl);
  realSec += dtReal;
}
check('return: reached the mothership', r.status === 'captured', `status=${r.status} fuel=${r.fuel.toFixed(1)}% ship=${formatShipTime(r.clock.ship)} outside=${formatOutside(r.clock.outside)} ${r.reason}`);

// ---- 開始の遅れに対する頑健さ（窓を逃しても次の窓で行ける） ----
for (const delay of [1, 3, 6, 10, 20, 40]) {
  const ob = createOutbound();
  const gd = new OrbitGuide();
  for (let i = 0; i < delay * 60; i++) ob.step(dtReal / REAL_SEC_PER_UNIT, dtReal, { rot: 0, thrust: 0 });
  let rs = 0;
  while (ob.status === 'flying' && rs < 900) { const c = gd.update(ob); ob.step(dtReal / REAL_SEC_PER_UNIT * (c.thrust > 0 ? 1 : gd.warp), dtReal, c); rs += dtReal; }
  check(`outbound after ${delay}s delay`, ob.status === 'captured', `status=${ob.status} fuel=${ob.fuel.toFixed(0)}% outside=${formatOutside(ob.clock.outside)}`);
}
process.exit(failed ? 1 : 0);
