// The coach's voice (speech synthesis) and the compression beat (Web Audio).

export class Voice {
  constructor() {
    this.enabled = true;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.voice = null;
    this.pick();
    this.synth?.addEventListener?.('voiceschanged', () => this.pick());
  }

  get supported() {
    return Boolean(this.synth);
  }

  pick() {
    const voices = this.synth?.getVoices?.() || [];
    const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
    this.voice = english.find((v) => /Samantha|Google US English|Aria|Jenny|Natural/i.test(v.name))
      || english.find((v) => /en[-_]US/i.test(v.lang))
      || english[0]
      || null;
  }

  // iOS only lets a page speak after speech started inside a tap.
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  say(text, { interrupt = true, rate = 1.05, force = false } = {}) {
    if (!this.synth || !text || (!this.enabled && !force)) return;
    if (interrupt) this.synth.cancel();
    // Chrome cuts off long utterances, so speak one sentence at a time.
    for (const sentence of splitSentences(text)) {
      const u = new SpeechSynthesisUtterance(sentence);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang || 'en-US';
      u.rate = rate;
      this.synth.speak(u);
    }
  }

  stop() {
    this.synth?.cancel();
  }
}

export function splitSentences(text) {
  return String(text).match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

export class Metronome {
  constructor(bpm = 110) {
    this.bpm = bpm;
    this.ctx = null;
    this.timer = null;
    this.next = 0;
    this.on = false;
    this.enabled = true;
  }

  audio() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  start() {
    if (this.on || !this.enabled || !this.audio()) return;
    this.on = true;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.on = false;
    clearInterval(this.timer);
  }

  schedule() {
    const beat = 60 / this.bpm;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.tone(this.next, 1050, 0.05, 0.3);
      this.next += beat;
    }
  }

  tone(at, freq, length, volume) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  // Two rising notes: a message from the dispatcher.
  chime() {
    if (!this.audio()) return;
    const t = this.ctx.currentTime + 0.02;
    this.tone(t, 660, 0.18, 0.35);
    this.tone(t + 0.2, 990, 0.25, 0.35);
  }
}
