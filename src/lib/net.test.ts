import { describe, expect, it, vi } from 'vitest';
import { clockSkew, netWeak, noteNetFailure, noteNetOk } from './net';

describe('connection tracker', () => {
  it('counts the connection as weak for a minute after a network failure, until a reply comes back', () => {
    vi.useFakeTimers();
    expect(netWeak()).toBe(false);
    noteNetFailure();
    expect(netWeak()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(netWeak()).toBe(true);
    noteNetOk();
    expect(netWeak()).toBe(false);
    noteNetFailure();
    vi.advanceTimersByTime(61_000);
    expect(netWeak()).toBe(false);
    vi.useRealTimers();
  });
  it('measures how far this device clock is from the server', () => {
    noteNetOk(new Date(Date.now() - 15 * 60_000).toUTCString());
    expect(Math.round(clockSkew() / 60_000)).toBe(15);
    noteNetOk('not a date');
    expect(Math.round(clockSkew() / 60_000)).toBe(15);
  });
});
