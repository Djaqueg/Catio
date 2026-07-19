/**
 * Música ambiental y efectos sintetizados con Web Audio API
 * (sin archivos externos).
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = this._loadMutePreference();
    this._started = false;
    this._ambientNodes = [];
    this._meowTimer = null;
    this._stepCooldown = 0;
  }

  _loadMutePreference() {
    try {
      return localStorage.getItem('catio_audio_muted') !== '1';
    } catch {
      return true;
    }
  }

  _saveMutePreference() {
    try {
      localStorage.setItem('catio_audio_muted', this.enabled ? '0' : '1');
    } catch { /* ignore */ }
  }

  async unlock() {
    if (this._started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.7 : 0;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.28;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.55;
    this.sfxGain.connect(this.master);

    this._started = true;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.enabled) this._startAmbient();
  }

  setEnabled(on) {
    this.enabled = on;
    this._saveMutePreference();
    if (!this._started) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? 0.7 : 0, now, 0.08);
    if (on) {
      this._startAmbient();
      this._scheduleRandomMeows();
    } else {
      this._stopAmbient();
      clearTimeout(this._meowTimer);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  startGameAudio() {
    this.unlock().then(() => {
      if (this.enabled) {
        this._startAmbient();
        this._scheduleRandomMeows();
      }
    });
  }

  stopGameAudio() {
    this._stopAmbient();
    clearTimeout(this._meowTimer);
  }

  _startAmbient() {
    if (!this.ctx || this._ambientNodes.length) return;
    const now = this.ctx.currentTime;

    // Soft pad drones (pastel ambient)
    const padNotes = [196, 246.94, 293.66, 329.63]; // G3 A3 D4 E4
    padNotes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 680;
      filter.Q.value = 0.6;
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      gain.gain.linearRampToValueAtTime(0.045 + i * 0.008, now + 2.5 + i * 0.4);
      // Slow shimmer
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.02;
      lfoGain.gain.value = 12;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(now);
      this._ambientNodes.push(osc, gain, filter, lfo, lfoGain);
    });

    // Gentle arpeggio loop
    this._arpTimer = setInterval(() => this._playArpNote(), 920);
    this._ambientNodes.push({ stop: () => clearInterval(this._arpTimer) });
  }

  _playArpNote() {
    if (!this.ctx || !this.enabled) return;
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    const freq = scale[Math.floor(Math.random() * scale.length)];
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 1.5);
  }

  _stopAmbient() {
    const t = this.ctx?.currentTime || 0;
    this._ambientNodes.forEach((node) => {
      try {
        if (typeof node.stop === 'function') node.stop(t + 0.05);
        if (node.gain) {
          node.gain.cancelScheduledValues(t);
          node.gain.setTargetAtTime(0, t, 0.2);
        }
      } catch { /* already stopped */ }
    });
    this._ambientNodes = [];
    clearInterval(this._arpTimer);
  }

  _scheduleRandomMeows() {
    clearTimeout(this._meowTimer);
    if (!this.enabled) return;
    const delay = 9000 + Math.random() * 14000;
    this._meowTimer = setTimeout(() => {
      this.meow();
      this._scheduleRandomMeows();
    }, delay);
  }

  _tone({ freq = 440, type = 'sine', duration = 0.2, volume = 0.2, slideTo = null, filterFreq = 2000 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  meow() {
    if (!this.ctx || !this.enabled) return;
    const base = 680 + Math.random() * 220;
    this._tone({ freq: base, type: 'triangle', duration: 0.18, volume: 0.14, slideTo: base * 1.35, filterFreq: 2200 });
    setTimeout(() => {
      this._tone({ freq: base * 1.2, type: 'sine', duration: 0.28, volume: 0.1, slideTo: base * 0.75, filterFreq: 1800 });
    }, 90);
  }

  purr() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 28 + i * 2;
      gain.gain.setValueAtTime(0, t + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.03, t + i * 0.08 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.25);
    }
  }

  softStep() {
    if (!this.ctx || !this.enabled) return;
    const now = performance.now();
    if (now - this._stepCooldown < 120) return;
    this._stepCooldown = now;
    this._tone({ freq: 140 + Math.random() * 40, type: 'sine', duration: 0.07, volume: 0.04, filterFreq: 400 });
  }

  place() {
    this._tone({ freq: 520, type: 'triangle', duration: 0.12, volume: 0.12, slideTo: 780, filterFreq: 2400 });
    setTimeout(() => this._tone({ freq: 880, type: 'sine', duration: 0.18, volume: 0.08, filterFreq: 3000 }), 70);
  }

  uiClick() {
    this._tone({ freq: 660, type: 'sine', duration: 0.06, volume: 0.07, filterFreq: 2500 });
  }

  upgrade() {
    this._tone({ freq: 440, type: 'triangle', duration: 0.1, volume: 0.1, slideTo: 660 });
    setTimeout(() => this._tone({ freq: 880, type: 'sine', duration: 0.2, volume: 0.09, slideTo: 1100 }), 80);
  }

  happyChime() {
    [523, 659, 784].forEach((freq, i) => {
      setTimeout(() => this._tone({ freq, type: 'sine', duration: 0.2, volume: 0.07 }), i * 90);
    });
  }
}

export const audio = new AudioManager();
