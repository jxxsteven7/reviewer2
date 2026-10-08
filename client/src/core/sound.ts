import type { Emote } from '@reviewer2/shared';
import { ref } from 'vue';
import { readStored, writeStored } from './storage';

// The sounds of the quick reactions. They are made with Web Audio as they play, so that the page
// carries no audio files. Phones, WeChat's browser among them, let a page make a sound only after
// the player has touched it, so the audio is unlocked by the first touch, click or key press, and
// stays silent until then. Whoever turns the sounds off keeps them off on their next visit.

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
};

let audio: AudioContext | null = null;

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
  return audio;
}

// The events that count as the player's own gesture, which lets a page start its audio. iOS takes
// the end of a touch rather than its start.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

// Creates the audio, or wakes it up, inside a gesture. Older versions of iOS also want a sound to
// start within the gesture, and a sample of silence will do. Once the audio runs, it is left alone.
function unlock(): void {
  const context = audioContext();
  if (!context) return;
  if (context.state === 'running') {
    for (const gesture of GESTURES) window.removeEventListener(gesture, unlock, true);
    return;
  }
  try {
    context.resume().catch(() => {});
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
