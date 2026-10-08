// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { muted, playSound, setMuted, unlocked } from './sound';
import { readStored } from './storage';

// A browser's audio, as far as sound.ts touches it: it starts asleep, wakes up when it is resumed,
// and says when its state changes. A phone puts it back to sleep.
class FakeAudio extends EventTarget {
  static made: FakeAudio[] = [];
  state = 'suspended';
  resumed = 0;
  destination = {};
  constructor() {
    super();
    FakeAudio.made.push(this);
  }
  resume(): Promise<void> {
    this.resumed += 1;
    this.sleep('running');
    return Promise.resolve();
  }
  sleep(state = 'suspended'): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
  createBuffer(): object {
    return {};
  }
  createBufferSource(): { buffer: unknown; connect(): void; start(): void } {
    return { buffer: null, connect() {}, start() {} };
  }
}

describe('the sounds', () => {
  test('are remembered as off or on, in storage that never throws', () => {
    expect(muted.value).toBe(false);
    setMuted(true);
    expect(muted.value).toBe(true);
    expect(readStored('r2.muted')).toBe('1');
    setMuted(false);
    expect(readStored('r2.muted')).toBe('0');
  });

  test('stay silent, without an error, where the browser has no audio or nobody has touched the page', () => {
    expect(() => playSound('reviewer2')).not.toThrow();
    window.dispatchEvent(new Event('click'));
    expect(() => playSound('waiting')).not.toThrow();
    expect(unlocked.value).toBe(false);
  });

  test('wake the audio up on a touch, and again after the phone has put it to sleep', async () => {
    Object.assign(window, { AudioContext: FakeAudio });
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    const [audio] = FakeAudio.made;
    expect(FakeAudio.made).toHaveLength(1);
    expect(audio?.resumed).toBe(1);
    expect(unlocked.value).toBe(true);

    // The screen was locked, or a call came in.
    audio?.sleep();
    expect(unlocked.value).toBe(false);
    expect(() => playSound('deadline')).not.toThrow();
    window.dispatchEvent(new Event('touchend'));
    await Promise.resolve();
    expect(audio?.resumed).toBe(2);
    expect(unlocked.value).toBe(true);
    // A touch while it runs leaves it alone.
    window.dispatchEvent(new Event('pointerdown'));
    expect(audio?.resumed).toBe(2);
    expect(FakeAudio.made).toHaveLength(1);
  });
});
