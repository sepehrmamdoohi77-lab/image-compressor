import { z } from 'zod';
import { configSchema, healthSchema, profileSchema, type Profile } from '../multiplayer/protocol';
import { guestTransport, type GuestGrant } from './GuestTransport';

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const grantSchema = z
  .object({
    profile: profileSchema,
    transportToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    transportExpiresAt: z.number().int().positive(),
  })
  .strict();
const sessionSchema = z
  .object({
    profile: profileSchema.nullable(),
    roomCode: z
      .string()
      .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
      .nullable(),
  })
  .strict();

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const grant = guestTransport.get();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (grant) headers.Authorization = `Bearer ${grant.transportToken}`;
    const response = await fetch(`/arena/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('Room service returned an unreadable response. Please retry.');
    }
    if (!response.ok) {
      const detail = z.object({ detail: z.string() }).safeParse(data);
      throw new RequestError(
        detail.success ? detail.data.detail : 'The server could not process this request.',
        response.status,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('Server response is incompatible with this game version.');
    return parsed.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new Error('Server connection timed out. Try again.');
    if (error instanceof TypeError)
      throw new Error('Room service is unavailable. Check your connection and try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function currentSession() {
  try {
    return await request('session', sessionSchema);
  } catch (error) {
    if (error instanceof RequestError && error.status === 401 && guestTransport.get()) {
      guestTransport.clear();
      return request('session', sessionSchema);
    }
    throw error;
  }
}
async function saveGuest(name: string): Promise<Profile> {
  let result: z.infer<typeof grantSchema>;
  try {
    result = await request('session', grantSchema, { name, transport: true });
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 401)) throw error;
    guestTransport.clear();
    result = await request('session', grantSchema, { name, transport: true });
  }
  guestTransport.set(result);
  return result.profile;
}
async function ensureTransport(): Promise<GuestGrant> {
  const existing = guestTransport.get();
  if (existing) return existing;
  const result = await request('session/transport', grantSchema, {});
  guestTransport.set(result);
  return result;
}

export const Api = {
  saveLoadout: async (primary: string, cosmetic: string): Promise<Profile> =>
    (await request('loadout', z.object({ profile: profileSchema }).strict(), { primary, cosmetic }))
      .profile,
  config: () => request('config', configSchema),
  health: () => request('health', healthSchema),
  session: currentSession,
  saveGuest,
  ensureTransport,
};
