import type { Emote } from '@reviewer2/shared';
import { ref } from 'vue';
import { readStored, writeStored } from './storage';

// The sounds of the quick reactions. They are made with Web Audio as they play, so that the page
// carries no audio files. Phones, WeChat's browser among them, let a page make a sound only after
// the player has touched it, so the audio is unlocked by a touch, click or key press, and stays
// silent until then. Whoever turns the sounds off keeps them off on their next visit.

const MUTED = 'r2.muted';

export const muted = ref(readStored(MUTED) === '1');

export function setMuted(value: boolean): void {
  muted.value = value;
  writeStored(MUTED, value ? '1' : '0');
}

interface Tone {
  type: OscillatorType;
  // The pitch at the start and at the end, in hertz.
  from: number;
  to?: number;
  // When it starts and how long it lasts, in seconds.
  at: number;
  length: number;
  volume?: number;
  // A low-pass filter that softens a buzzing wave, in hertz.
  filter?: number;
}

// One note: a quick rise, a slide from one pitch to the other, and a soft fade.
function tone(audio: AudioContext, { type, from, to = from, at, length, volume = 0.2, filter }: Tone): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, at);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  let output: AudioNode = oscillator;
  if (filter !== undefined) {
    const lowPass = audio.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = filter;
    output = output.connect(lowPass);
  }
  output.connect(gain).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

// What each reaction sounds like, starting at `at` on the audio clock. All of them are made here,
// from plain waves, and none is taken from a game.
//
// To play a recording instead, put the file in client/src/assets, so that the build serves it from
// our own server, fetch it and decode it once with audio.decodeAudioData(), and play the buffer here
// through an AudioBufferSourceNode connected to audio.destination.
const SOUNDS: Record<Emote, (audio: AudioContext, at: number) => void> = {
  // A sagging "wah, wah, wah, waaah": the flowers have wilted.
  waiting(audio, at) {
    const steps = [
      [392, 370],
      [370, 349],
      [349, 330],
      [330, 247],
    ] as const;
    steps.forEach(([from, to], i) =>
      tone(audio, { type: 'triangle', from, to, at: at + i * 0.3, length: i === 3 ? 0.9 : 0.26, volume: 0.25 }),
    );
  },
  // A clock ticking fast, then an alarm.
  deadline(audio, at) {
    for (let i = 0; i < 6; i += 1) {
      tone(audio, { type: 'square', from: 2400, at: at + i * 0.08, length: 0.025, volume: 0.06 });
    }
    for (let i = 0; i < 3; i += 1) {
      tone(audio, { type: 'square', from: 880, at: at + 0.55 + i * 0.15, length: 0.1, volume: 0.1, filter: 3000 });
    }
  },
  // Two low notes a tritone apart, the interval that was once called the devil's: Reviewer 2.
  reviewer2(audio, at) {
    tone(audio, { type: 'sawtooth', from: 147, at, length: 0.45, volume: 0.3, filter: 600 });
    tone(audio, { type: 'sawtooth', from: 104, to: 98, at: at + 0.5, length: 1.1, volume: 0.3, filter: 450 });
  },
  // A rising major chord, note by note, with the top held: accepted as it is.
  accept(audio, at) {
    [523, 659, 784].forEach((pitch, i) =>
      tone(audio, { type: 'triangle', from: pitch, at: at + i * 0.11, length: 0.18, volume: 0.18 }),
    );
    tone(audio, { type: 'triangle', from: 1047, at: at + 0.33, length: 0.7, volume: 0.2 });
  },
  // Three quick sparkles going up, like a pen flourish: a clue to be proud of.
  great_clue(audio, at) {
    [880, 1109, 1319].forEach((pitch, i) =>
      tone(audio, { type: 'sine', from: pitch, to: pitch * 1.06, at: at + i * 0.09, length: 0.16, volume: 0.16 }),
    );
    tone(audio, { type: 'sine', from: 1760, at: at + 0.3, length: 0.35, volume: 0.1 });
  },
  // Three notes sliding down a semitone each, the sound of raised eyebrows: suspicious.
  p_hacking(audio, at) {
    [440, 415, 392].forEach((pitch, i) =>
      tone(audio, {
        type: 'sawtooth',
        from: pitch,
        to: pitch * 0.97,
        at: at + i * 0.22,
        length: 0.2,
        volume: 0.14,
        filter: 1200,
      }),
    );
  },
  // A rubber stamp coming down, then a low buzz: sent back for a major revision.
  major_revision(audio, at) {
    tone(audio, { type: 'sine', from: 160, to: 60, at, length: 0.12, volume: 0.3 });
    tone(audio, { type: 'square', from: 196, at: at + 0.2, length: 0.4, volume: 0.08, filter: 800 });
  },
  // A long sigh down, and a small hopeful note back up: on to the next venue.
  resubmit(audio, at) {
    tone(audio, { type: 'sine', from: 440, to: 300, at, length: 0.6, volume: 0.18 });
    tone(audio, { type: 'sine', from: 330, to: 392, at: at + 0.7, length: 0.3, volume: 0.14 });
  },
  // Two notes rising like a question, asked twice: please, please.
  first_author(audio, at) {
    for (let i = 0; i < 2; i += 1) {
      tone(audio, { type: 'triangle', from: 392, to: 523, at: at + i * 0.4, length: 0.3, volume: 0.16 });
    }
  },
  // A doorbell's two notes: a knock on the door for the next paper.
  coauthor(audio, at) {
    tone(audio, { type: 'triangle', from: 659, at, length: 0.35, volume: 0.18 });
    tone(audio, { type: 'triangle', from: 523, at: at + 0.3, length: 0.6, volume: 0.18 });
  },
  // Typing late at night, then the carriage bell: an all-nighter.
  all_nighter(audio, at) {
    for (let i = 0; i < 5; i += 1) {
      tone(audio, { type: 'square', from: 1800, at: at + i * 0.09, length: 0.02, volume: 0.05 });
    }
    tone(audio, { type: 'sine', from: 1568, at: at + 0.5, length: 0.5, volume: 0.12 });
  },
  // Two little hops up, twice: mine, mine.
  mine_mine(audio, at) {
    for (let i = 0; i < 2; i += 1) {
      tone(audio, { type: 'triangle', from: 587, to: 784, at: at + i * 0.32, length: 0.12, volume: 0.16 });
      tone(audio, { type: 'triangle', from: 784, at: at + i * 0.32 + 0.13, length: 0.14, volume: 0.16 });
    }
  },
};

let audio: AudioContext | null = null;

// Whether the audio runs, for a page to say when it doesn't: a big screen that nobody has clicked
// would stay silent without a word otherwise.
export const unlocked = ref(false);

const sync = () => {
  unlocked.value = audio?.state === 'running';
};

function audioContext(): AudioContext | null {
  if (audio) return audio;
  const Context =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    audio = new Context();
  } catch {
    return null;
  }
  audio.addEventListener('statechange', sync);
  sync();
  return audio;
}

// The events that count as the player's own gesture, which lets a page start its audio. iOS takes
// the end of a touch rather than its start.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

// Creates the audio, or wakes it up, inside a gesture. Older versions of iOS also want a sound to
// start within the gesture, and a sample of silence will do. The listeners stay for as long as
// the page does: a phone that was locked, a call, or a switch to another app puts the audio to
// sleep again, and only the next touch may wake it up.
function unlock(): void {
  const context = audioContext();
  if (!context || context.state === 'running') return;
  try {
    context.resume().then(sync, () => {});
  } catch {
    // Older versions of WebKit give nothing back from resume() to catch.
  }
  try {
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, 22050);
    silence.connect(context.destination);
    silence.start(0);
  } catch {
    // The next gesture tries again.
  }
}

for (const gesture of GESTURES) window.addEventListener(gesture, unlock, { capture: true, passive: true });

// Plays a reaction's sound, unless the sounds are off or the player hasn't touched the page yet.
export function playSound(emote: Emote): void {
  if (muted.value || !audio || audio.state !== 'running') return;
  try {
    SOUNDS[emote](audio, audio.currentTime + 0.01);
  } catch {
    // A sound that can't be made is no reason to stop the game.
  }
}
