// Web Audio API Soft Chime Synthesizer
// Generates a calming, gentle marimba/bell tone that won't startle a sleeping baby

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._unlocked = false;
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  unlock() {
    if (this._unlocked) return;
    this._initContext();
    if (this.ctx) {
      // Play a silent buffer to unlock on iOS Safari
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.ctx.destination);
      node.start(0);
      this._unlocked = true;
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  // Soft double-tap or triple-tap chime
  playChime(type = 'complete') {
    if (!this.enabled) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Harmonic frequencies for gentle tones
    let freqs = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad
    if (type === 'alert') {
      freqs = [659.25, 587.33, 659.25]; // E5, D5, E5 gentle reminder
    } else if (type === 'tick') {
      freqs = [880];
    }

    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Sine wave with subtle lowpass filter for silky soft tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);

      // Smooth envelope: soft attack, gentle decay
      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.65);
    });
  }

  playMilestoneChime() {
    if (!this.enabled) return;
    this._initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.001, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.2, now + idx * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.7);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.75);
    });
  }

  vibrate(pattern = [100, 50, 100]) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Ignore silent failure
      }
    }
  }
}

export const sound = new SoundManager();

// Automatically listen for first tap on document to unlock audio context
['click', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, () => sound.unlock(), { once: true, passive: true });
});
