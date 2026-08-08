// ==========================================
// Semaphore + structured logger tests
// ==========================================
import { describe, it, expect } from 'vitest';
import { Semaphore } from '../lib/semaphore';
import { write, pickLevel } from '../lib/structuredLogger';

describe('Semaphore', () => {
  it('limits concurrent acquisitions to max', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let max = 0;
    const work = async () => {
      const release = await s.acquire();
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      release();
    };
    await Promise.all([work(), work(), work(), work()]);
    expect(max).toBeLessThanOrEqual(2);
    expect(s.available).toBe(2);
  });

  it('releases in order so a waiter can proceed', async () => {
    const s = new Semaphore(1);
    const order = [];
    const a = s.acquire().then((rel) => { order.push('a'); rel(); });
    const b = s.acquire().then((rel) => { order.push('b'); rel(); });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('structuredLogger.write', () => {
  it('emits valid JSON when STRUCTURED_LOGS is true', () => {
    const prev = process.env.STRUCTURED_LOGS;
    process.env.STRUCTURED_LOGS = 'true';
    const chunks = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      write('info', 'hello', { userId: 7 });
    } finally {
      process.stdout.write = origStdout;
      if (prev === undefined) delete process.env.STRUCTURED_LOGS; else process.env.STRUCTURED_LOGS = prev;
    }
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.userId).toBe(7);
    expect(typeof parsed.time).toBe('string');
  });

  it('pickLevel defaults unknown levels to info', () => {
    expect(pickLevel('nonsense')).toBe('info');
    expect(pickLevel('error')).toBe('error');
  });
});
