// 時間の遅れ（カー・ブラックホールの赤道面・順行円軌道）
//
// 円軌道を回る観測者の時計は、遠方の時計に対して u^t 倍ゆっくり進む（G = c = M = 1 の単位）:
//   u^t = (r^{3/2} + a) / ( r^{3/4} * sqrt(r^{3/2} - 3 r^{1/2} + 2a) )
// 「惑星での1時間が外の約7年」（約6万倍）になるには、自転がほぼ限界（1 - a ≈ 1e-14）の
// ブラックホールの、最内安定円軌道のすぐ外側を回る必要がある。
//
// ゲーム内の距離（2D軌道図の単位）はブラックホールのそばを遊べる大きさに縮めてあるので、
// ゲーム内の半径 → カー時空の半径 を単調な対応で結び、その半径の円軌道の式で時間の遅れを求める。
// 円軌道でない飛行中（遷移軌道など）は、その瞬間の半径の円軌道の値で近似する。

export const SPIN_DEFICIT = 1e-14; // 1 - a
export const SPIN = 1 - SPIN_DEFICIT;
export const HOURS_PER_YEAR = 365.25 * 24;
export const TARGET_FACTOR = 7 * HOURS_PER_YEAR; // 1時間 = 7年
export const MAX_FACTOR = 1e6;

export function kerrUt(r, a = SPIN) {
  const d = Math.pow(r, 1.5) - 3 * Math.sqrt(r) + 2 * a;
  if (d <= 0) return Infinity; // 光子軌道より内側: 円軌道は存在しない
  return (Math.pow(r, 1.5) + a) / (Math.pow(r, 0.75) * Math.sqrt(d));
}

export function iscoRadius(a = SPIN) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

// u^t が target になる半径（ISCO より外側）
function solveRadius(target) {
  let lo = iscoRadius(), hi = 50;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (kerrUt(m) > target) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export const R_KERR_PLANET = solveRadius(TARGET_FACTOR);
export const R_KERR_MOTHER = 20;

// ゲーム内半径の対応づけ: (r_K - 1) を、ゲーム内半径のべき乗で補間する
let MAP = null;
export function configureMapping(rGamePlanet, rGameMother) {
  const xp = R_KERR_PLANET - 1;
  const xm = R_KERR_MOTHER - 1;
  MAP = { rGamePlanet, xp, k: Math.log(xm / xp) / Math.log(rGameMother / rGamePlanet) };
}

export function kerrRadiusFor(rGame) {
  return 1 + MAP.xp * Math.pow(rGame / MAP.rGamePlanet, MAP.k);
}

// ゲーム内半径での時間の遅れ（外の時間 / 自分の時間）
export function dilationAt(rGame) {
  const f = kerrUt(kerrRadiusFor(rGame));
  return Math.min(MAX_FACTOR, Math.max(1, f));
}
