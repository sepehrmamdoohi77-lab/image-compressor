import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestTransportStore } from '../../src/services/GuestTransport';

const key = 'tactical-arena.guest-transport.v1';
const grant = () => ({
  transportToken: 'a'.repeat(43),
  transportExpiresAt: Math.floor(Date.now() / 1000) + 3600,
});
function storage() {
  const data = new Map<string, string>();
  const fake = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  vi.stubGlobal('sessionStorage', fake);
  return data;
}
afterEach(() => vi.unstubAllGlobals());

describe('real guest transport credential lifecycle', () => {
  it('restores only a valid tab credential without localStorage', () => {
    const data = storage();
    const first = new GuestTransportStore();
    first.set(grant());
    expect(data.has(key)).toBe(true);
    expect(new GuestTransportStore().get()?.transportExpiresAt).toBe(grant().transportExpiresAt);
  });
  it('clears expired credentials rather than claiming an authenticated identity', () => {
    const data = storage();
    data.set(key, JSON.stringify({ ...grant(), transportExpiresAt: 1 }));
    expect(new GuestTransportStore().get()).toBeNull();
    expect(data.has(key)).toBe(false);
  });
  it('rejects public player IDs and malformed data as authorization', () => {
    storage();
    const current = new GuestTransportStore();
    expect(() =>
      current.set({ ...grant(), transportToken: '00000000-0000-4000-8000-000000000001' }),
    ).toThrow();
    expect(current.get()).toBeNull();
  });
  it('keeps a working in-memory grant if browser tab storage is denied', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage blocked');
      },
      removeItem: () => {
        throw new Error('Storage blocked');
      },
    });
    const current = new GuestTransportStore();
    current.set(grant());
    expect(current.get()).not.toBeNull();
    current.clear();
    expect(current.get()).toBeNull();
  });
});
