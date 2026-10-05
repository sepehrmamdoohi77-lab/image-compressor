/** Per-tab opaque guest grant. Not a backend key, player ID, or URL credential.
 * Cookies remain HttpOnly. This separate, expiring grant covers iframe policies
 * that omit cookies from fetch/WebSocket requests. No localStorage is used.
 */
export interface GuestGrant {
  transportToken: string;
  transportExpiresAt: number;
}
const KEY = 'tactical-arena.guest-transport.v1';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class GuestTransportStore {
  private grant: GuestGrant | null = null;
  constructor() {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
      if (this.valid(value)) this.grant = value;
      else sessionStorage.removeItem(KEY);
    } catch {
      /* Memory-only authorization still works when browser storage is blocked. */
    }
  }
  private valid(value: unknown): value is GuestGrant {
    if (!value || typeof value !== 'object') return false;
    const grant = value as Partial<GuestGrant>;
    return (
      typeof grant.transportToken === 'string' &&
      tokenPattern.test(grant.transportToken) &&
      typeof grant.transportExpiresAt === 'number' &&
      Number.isSafeInteger(grant.transportExpiresAt) &&
      grant.transportExpiresAt > Date.now() / 1000
    );
  }
  get(): GuestGrant | null {
    if (!this.valid(this.grant)) {
      this.clear();
      return null;
    }
    return { ...this.grant };
  }
  set(grant: GuestGrant): void {
    if (!this.valid(grant))
      throw new Error('Server returned an invalid guest authorization grant.');
    this.grant = { ...grant };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(this.grant));
    } catch {
      /* Keep only in this page's memory; never pretend persistence succeeded. */
    }
  }
  clear(): void {
    this.grant = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* Browser policy can deny storage. */
    }
  }
}
export const guestTransport = new GuestTransportStore();
export const AUTH_SUBPROTOCOL = 'tactical-arena-auth';
