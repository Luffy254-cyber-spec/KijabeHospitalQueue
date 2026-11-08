/** Procedural seaside ambient — wind, splash, gulls, dolphin, whale, crab, starfish, ship. */

type Ctx = AudioContext;

function ctxResume(ctx: Ctx) {
  if (ctx.state === "suspended") void ctx.resume();
}

function noiseBuffer(ctx: Ctx, seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class OceanAmbient {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private timers: number[] = [];
  private enabled = false;
  /** Calm waiting-room mode: softer wind, gentle waves, quieter creatures */
  private calm = false;
  private baseGain = 0.22;
  private ducked = false;

  /** Soft seaside bed for waiting rooms (quieter than staff login). */
  startCalm() {
    this.calm = true;
    this.baseGain = 0.11;
    this.start();
  }

  start() {
    if (this.enabled) {
      if (this.ctx) ctxResume(this.ctx);
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    ctxResume(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.baseGain;
    this.master.connect(this.ctx.destination);
    this.enabled = true;
    this.ducked = false;
    this.startWind();
    this.scheduleLoop();
  }

  /** Browsers suspend audio until a gesture: resume without rebuilding the bed. */
  resume() {
    if (this.ctx) ctxResume(this.ctx);
  }

  /** Soft fade for ticket announcements — hope music pauses separately. */
  duck(factor = 0.08) {
    if (!this.master || !this.ctx) return;
    this.ducked = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.baseGain * factor, t + 0.18);
  }

  unduck() {
    if (!this.master || !this.ctx) return;
    this.ducked = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.baseGain, t + 0.45);
  }

  setVolume(level: number) {
    this.baseGain = Math.max(0.02, Math.min(0.35, level));
    if (this.master && this.ctx && !this.ducked) {
      this.master.gain.setTargetAtTime(this.baseGain, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    this.enabled = false;
    this.ducked = false;
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    try { this.wind?.stop(); } catch { /* */ }
    this.wind = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private startWind() {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, 2);
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = this.calm ? 380 : 420;
    filter.Q.value = this.calm ? 0.55 : 0.7;
    const g = this.ctx.createGain();
    g.gain.value = this.calm ? 0.055 : 0.08;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
    this.wind = src;
  }

  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      if (!this.enabled) return;
      fn();
    }, ms);
    this.timers.push(id);
  }

  private scheduleLoop() {
    if (!this.enabled) return;
    const roll = Math.random();
    if (this.calm) {
      // Peaceful bed: soft waves + distant life, with audible distant ship horns
      if (roll < 0.36) this.softWave();
      else if (roll < 0.5) this.splash(0.1);
      else if (roll < 0.62) this.fishTick();
      else if (roll < 0.72) this.gull();
      else if (roll < 0.8) this.dolphinClick();
      else if (roll < 0.86) this.whaleSong();
      else if (roll < 0.92) this.shipHorn();
      else if (roll < 0.96) this.crabSkitter();
      else this.starfishTap();
      this.later(4800 + Math.random() * 9000, () => this.scheduleLoop());
      return;
    }
    if (roll < 0.2) this.splash();
    else if (roll < 0.36) this.gull();
    else if (roll < 0.48) this.fishTick();
    else if (roll < 0.56) this.shipHorn();
    else if (roll < 0.66) this.softWave();
    else if (roll < 0.76) this.dolphinClick();
    else if (roll < 0.86) this.whaleSong();
    else if (roll < 0.94) this.crabSkitter();
    this.later(3200 + Math.random() * 6500, () => this.scheduleLoop());
  }

  /** Breach out of water */
  dolphinExit() {
    this.splash(0.38);
    this.later(80, () => this.dolphinWhistle());
  }

  /** Re-enter water */
  dolphinEnter() {
    this.splash(0.48);
    this.later(40, () => this.dolphinClick());
  }

  dolphinSplash() {
    this.dolphinExit();
    this.later(1600, () => this.dolphinEnter());
  }

  whaleBreach() {
    this.splash(0.5);
    this.later(200, () => this.whaleSong());
  }

  crabWalk() {
    this.crabSkitter();
  }

  starfishCrawl() {
    this.starfishTap();
  }

  shipPass() {
    // Classic two-blast hoot as the ship sails past
    this.shipHorn();
    this.later(900, () => this.shipHorn());
  }

  private splash(intensity = 0.22) {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, 0.4);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(intensity, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(t + 0.55);
  }

  private softWave() {
    this.splash(0.12);
  }

  private dolphinWhistle() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.42);
  }

  private dolphinClick() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    for (let i = 0; i < 5; i++) {
      this.later(i * 55, () => {
        if (!this.ctx || !this.master) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "square";
        const t = this.ctx.currentTime;
        o.frequency.value = 1600 + Math.random() * 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        o.connect(g);
        g.connect(this.master!);
        o.start(t);
        o.stop(t + 0.05);
      });
    }
  }

  private whaleSong() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o2.type = "triangle";
    const t = this.ctx.currentTime;
    const peak = this.calm ? 0.045 : 0.09;
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    o.frequency.exponentialRampToValueAtTime(60, t + 2.4);
    o2.frequency.setValueAtTime(120, t);
    o2.frequency.exponentialRampToValueAtTime(90, t + 2.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.3);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g);
    o2.connect(g);
    g.connect(this.master);
    o.start(t);
    o2.start(t);
    o.stop(t + 2.7);
    o2.stop(t + 2.7);
  }

  private crabSkitter() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    for (let i = 0; i < 8; i++) {
      this.later(i * 70, () => {
        if (!this.ctx || !this.master) return;
        const src = this.ctx.createBufferSource();
        src.buffer = noiseBuffer(this.ctx, 0.05);
        const filter = this.ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 2500;
        const g = this.ctx.createGain();
        const t = this.ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.04, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(filter);
        filter.connect(g);
        g.connect(this.master!);
        src.start(t);
        src.stop(t + 0.06);
      });
    }
  }

  private gull() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.42);
    this.later(180, () => {
      if (!this.ctx || !this.master) return;
      const o2 = this.ctx.createOscillator();
      const g2 = this.ctx.createGain();
      o2.type = "sine";
      const t2 = this.ctx.currentTime;
      o2.frequency.setValueAtTime(1400, t2);
      o2.frequency.exponentialRampToValueAtTime(2000, t2 + 0.08);
      o2.frequency.exponentialRampToValueAtTime(1000, t2 + 0.28);
      g2.gain.setValueAtTime(0.0001, t2);
      g2.gain.exponentialRampToValueAtTime(0.07, t2 + 0.03);
      g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.3);
      o2.connect(g2);
      g2.connect(this.master!);
      o2.start(t2);
      o2.stop(t2 + 0.32);
    });
  }

  private fishTick() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    const t = this.ctx.currentTime;
    o.frequency.value = 680 + Math.random() * 400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  private shipHorn() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o2.type = "sine";
    const t = this.ctx.currentTime;
    o.frequency.value = 110;
    o2.frequency.value = 165;
    // Calm master gain is low — boost peak so the hoot stays audible
    const peak = this.calm ? 0.2 : 0.09;
    const sustain = this.calm ? 0.12 : 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.15);
    g.gain.exponentialRampToValueAtTime(sustain, t + 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(g);
    o2.connect(g);
    g.connect(this.master);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.75);
    o2.stop(t + 1.75);
  }

  private starfishTap() {
    if (!this.ctx || !this.master) return;
    ctxResume(this.ctx);
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      const t = t0 + i * 0.14;
      o.frequency.value = 320 + i * 40 + Math.random() * 30;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(this.calm ? 0.035 : 0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}
