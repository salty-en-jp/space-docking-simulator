// Web Audio によるオリジナルのオルガン風BGMと効果音（音源ファイル不要）
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.tension = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // リバーブ（減衰ノイズのインパルス応答）
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    // 音楽バス
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 900;
    this.musicBus.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.musicFilter.connect(this.reverb);

    // スラスタ音（フィルタしたノイズ）
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1800;
    nf.Q.value = 0.7;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    noise.connect(nf).connect(this.thrustGain).connect(this.master);
    noise.start();

    this.nextBar = ctx.currentTime + 0.2;
    this.bar = 0;
    this.setMusic(this.musicOn);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.8);
  }

  // オルガン音: 倍音を重ねた持続音
  organ(freq, t0, dur, vel = 1) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.18 * vel, t0 + 0.6);
    env.gain.setValueAtTime(0.18 * vel, t0 + dur - 0.8);
    env.gain.linearRampToValueAtTime(0, t0 + dur + 0.6);
    env.connect(this.musicBus);
    const partials = [[1, 1], [2, 0.5], [3, 0.22], [4, 0.18], [0.5, 0.35]];
    for (const [mult, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      o.detune.value = (Math.random() - 0.5) * 6;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(env);
      o.start(t0);
      o.stop(t0 + dur + 0.8);
    }
  }

  // 毎フレーム呼ぶ。tension(0..1) に応じて和音の密度と明るさが変わる
  update(tension, thrust) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.tension += (tension - this.tension) * 0.02;
    this.musicFilter.frequency.setTargetAtTime(700 + this.tension * 3500, ctx.currentTime, 0.5);
    this.thrustGain.gain.setTargetAtTime(Math.min(1, thrust) * 0.12, ctx.currentTime, 0.03);

    if (!this.musicOn) { this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.1); return; }
    const BAR = 4.8 - this.tension * 1.6;
    while (this.nextBar < ctx.currentTime + 0.3) {
      // A minor 系の静かな進行（オリジナル）
      const prog = [
        [57, 60, 64, 69], // Am
        [53, 57, 60, 65], // F
        [55, 59, 62, 67], // G
        [52, 57, 60, 64], // Am/E
        [50, 53, 57, 62], // Dm
        [53, 57, 60, 64], // Fmaj7
        [52, 56, 59, 64], // E
        [52, 56, 59, 62], // E7
      ];
      const chord = prog[this.bar % prog.length];
      const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
      const t0 = this.nextBar;
      this.organ(mtof(chord[0] - 24), t0, BAR, 0.9); // ペダル
      chord.forEach((n, i) => this.organ(mtof(n - 12), t0 + i * 0.04, BAR, 0.6));
      // 緊張が高まると上声部のアルペジオが加わる
      if (this.tension > 0.35) {
        const steps = this.tension > 0.7 ? 8 : 4;
        for (let s = 0; s < steps; s++) {
          const n = chord[s % chord.length] + (s >= 4 ? 12 : 0);
          this.organ(mtof(n), t0 + (s * BAR) / steps, BAR / steps + 0.2, 0.35 + this.tension * 0.3);
        }
      }
      this.nextBar += BAR;
      this.bar++;
    }
  }

  clunk() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.9);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(f).connect(ng).connect(this.master);
    ng.connect(this.reverb);
    n.start(t); n.stop(t + 0.4);
  }

  beep(freq = 880, dur = 0.12, count = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * dur * 1.8;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.setValueAtTime(0, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }

  crash() {
    if (!this.ctx) return;
    this.clunk();
    this.beep(440, 0.25, 4);
  }

  // ドッキング成功時の明るい和音
  triumph() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.6;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    [45, 57, 61, 64, 69, 73].forEach((n, i) => this.organ(mtof(n), t + i * 0.12, 6, 0.8));
  }
}
