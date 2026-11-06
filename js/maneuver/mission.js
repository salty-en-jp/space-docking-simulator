// マニューバ編のミッション進行（初期状態と、段階のつなぎ）
import { Body, OrbitSim, R_MOTHER, R_PLANET, omegaCirc, vCirc, TRANSFER_OUT } from './orbit.js';
import { LanderSim } from './lander.js';
import { dilationAt } from './relativity.js';

export const WAIT_UNITS = 3.0; // 最初の噴射タイミングまでの待ち時間（軌道時間単位、加速1倍で約16秒）

export function createOutbound() {
  const clock = { ship: 0, outside: 0 };
  const mother = new Body(R_MOTHER, 0.012); // 母船は少し前方
  const ws = omegaCirc(R_MOTHER);
  const wp = omegaCirc(R_PLANET);
  const req = TRANSFER_OUT.sweep - wp * TRANSFER_OUT.time;
  const planet = new Body(R_PLANET, req + (wp - ws) * WAIT_UNITS);
  const v = vCirc(R_MOTHER);
  return new OrbitSim({
    ship: { x: R_MOTHER, y: 0, vx: 0, vy: v, heading: Math.PI / 2 },
    planet, mother, fuel: 100, target: 'planet', clock,
  });
}

export function createLanding(orbit) {
  return new LanderSim({ fuel: orbit.fuel });
}

// 着陸船の経過時間を時計に加える（惑星の上では惑星の公転軌道と同じ時間の遅れ）
export function landerClockTick(clock, dtShipMinutes) {
  clock.ship += dtShipMinutes;
  clock.outside += dtShipMinutes * dilationAt(R_PLANET);
}

export function createReturn(orbit, lander) {
  const t = orbit.t;
  const [px, py] = orbit.planet.pos(t);
  const [vx, vy] = orbit.planet.vel(t);
  const r = Math.hypot(px, py);
  const k = (r + 0.03) / r;
  const vk = vCirc(r + 0.03) / vCirc(r);
  return new OrbitSim({
    ship: { x: px * k, y: py * k, vx: vx * vk, vy: vy * vk, heading: Math.atan2(vy, vx) },
    t0: t, planet: orbit.planet, mother: orbit.mother, fuel: lander.fuel, target: 'mother', clock: orbit.clock,
  });
}

export function formatShipTime(min) {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}時間${String(m).padStart(2, '0')}分`;
}
export function formatOutside(min) {
  const days = min / 60 / 24;
  const y = Math.floor(days / 365.25);
  const d = Math.floor(days - y * 365.25);
  if (y === 0 && days < 1) return formatShipTime(min);
  return y > 0 ? `${y}年${d}日` : `${d}日`;
}
