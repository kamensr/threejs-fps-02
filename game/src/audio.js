// Sound, synthesized: every effect is an oscillator or filtered noise burst
// built in code — no audio files, no network. The context only starts on a user
// gesture (unlock, called from the play click); before that every call is a
// no-op, so screenshot mode stays silent.
export function createAudio() {
  let context = null;
  let master = null;

  function unlock() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return;
    }
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = 0.35;
      master.connect(context.destination);
    } catch {
      context = null;
    }
  }

  function tone({ freq = 440, end = null, dur = 0.1, type = 'sine', gain = 0.3, at = 0 }) {
    if (!context) return;
    const t0 = context.currentTime + at;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.1, freq = 1000, q = 1, gain = 0.3, type = 'lowpass', at = 0 }) {
    if (!context) return;
    const t0 = context.currentTime + at;
    const length = Math.max(1, Math.floor(context.sampleRate * dur));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(t0);
  }

  const SHOTS = {
    pistol: { dur: 0.09, freq: 1800, gain: 0.5, thump: 140 },
    smg: { dur: 0.07, freq: 2200, gain: 0.4, thump: 160 },
    rifle: { dur: 0.11, freq: 1400, gain: 0.55, thump: 110 },
    sniper: { dur: 0.22, freq: 900, gain: 0.7, thump: 70 },
  };

  return {
    unlock,
    get ready() {
      return !!context;
    },
    shot(weapon, distant = false) {
      const def = SHOTS[weapon] || SHOTS.rifle;
      const scale = distant ? 0.25 : 1;
      noise({ dur: def.dur, freq: def.freq, gain: def.gain * scale });
      tone({ freq: def.thump, end: 40, dur: def.dur + 0.03, type: 'sine', gain: 0.4 * scale });
    },
    dryFire() {
      tone({ freq: 2200, dur: 0.03, type: 'square', gain: 0.08 });
    },
    reload() {
      tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.1 });
      tone({ freq: 700, dur: 0.05, type: 'square', gain: 0.1, at: 0.15 });
    },
    hit(head) {
      tone({ freq: head ? 1600 : 1200, dur: 0.05, type: 'sine', gain: 0.25 });
    },
    kill() {
      tone({ freq: 880, dur: 0.07, type: 'sine', gain: 0.25 });
      tone({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.25, at: 0.07 });
    },
    hurt() {
      tone({ freq: 90, end: 50, dur: 0.18, type: 'sine', gain: 0.5 });
    },
    footstep() {
      noise({ dur: 0.05, freq: 400, gain: 0.08 });
    },
    beep(urgent = false) {
      tone({ freq: urgent ? 1200 : 880, dur: 0.07, type: 'square', gain: 0.15 });
    },
    tick() {
      tone({ freq: 1500, dur: 0.03, type: 'square', gain: 0.08 });
    },
    buy() {
      tone({ freq: 1040, dur: 0.06, type: 'sine', gain: 0.2 });
      tone({ freq: 1560, dur: 0.09, type: 'sine', gain: 0.2, at: 0.06 });
    },
    explosion() {
      noise({ dur: 0.9, freq: 300, gain: 0.9 });
      tone({ freq: 120, end: 30, dur: 0.8, type: 'sine', gain: 0.8 });
    },
    roundWin() {
      tone({ freq: 523, dur: 0.12, type: 'triangle', gain: 0.25 });
      tone({ freq: 659, dur: 0.12, type: 'triangle', gain: 0.25, at: 0.12 });
      tone({ freq: 784, dur: 0.2, type: 'triangle', gain: 0.25, at: 0.24 });
    },
    roundLose() {
      tone({ freq: 392, dur: 0.15, type: 'triangle', gain: 0.25 });
      tone({ freq: 262, dur: 0.25, type: 'triangle', gain: 0.25, at: 0.15 });
    },
  };
}
