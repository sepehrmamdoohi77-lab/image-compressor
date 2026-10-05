import {
  messageSchema,
  type ConnectionStatus,
  type InputIntent,
  type CombatEvent,
  type Profile,
  type Action,
  type RoomState,
  type ServerMessage,
  type Snapshot,
} from './protocol';

import { Api } from '../services/Api';
import { AUTH_SUBPROTOCOL, guestTransport } from '../services/GuestTransport';

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}
type Listener<T> = (value: T) => void;

/** Real WebSocket adapter. Presentation never writes authoritative room state. */
export class MultiplayerService {
  private socket: WebSocket | null = null;
  private intentionalClose = false;
  private fatal = false;
  private retries = 0;
  private reconnectTimer = 0;
  private handshakeTimer = 0;
  private pending = new Map<string, Pending>();
  private requestCounter = 0;
  private inputCounter = 0;
  private clockOffset: number | null = null;
  private connectionAttempt = 0;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private listeners = {
    room: new Set<Listener<RoomState | null>>(),
    snapshot: new Set<Listener<Snapshot>>(),
    combat: new Set<Listener<CombatEvent>>(),
    profile: new Set<Listener<Profile>>(),
    status: new Set<Listener<ConnectionStatus>>(),
    error: new Set<Listener<string>>(),
  };
  status: ConnectionStatus = 'idle';
  playerId: string | null = null;
  room: RoomState | null = null;

  onRoom(fn: Listener<RoomState | null>): () => void {
    this.listeners.room.add(fn);
    return () => this.listeners.room.delete(fn);
  }
  onSnapshot(fn: Listener<Snapshot>): () => void {
    this.listeners.snapshot.add(fn);
    return () => this.listeners.snapshot.delete(fn);
  }
  onStatus(fn: Listener<ConnectionStatus>): () => void {
    this.listeners.status.add(fn);
    return () => this.listeners.status.delete(fn);
  }
  onError(fn: Listener<string>): () => void {
    this.listeners.error.add(fn);
    return () => this.listeners.error.delete(fn);
  }
  onCombat(fn: Listener<CombatEvent>): () => void {
    this.listeners.combat.add(fn);
    return () => this.listeners.combat.delete(fn);
  }
  onProfile(fn: Listener<Profile>): () => void {
    this.listeners.profile.add(fn);
    return () => this.listeners.profile.delete(fn);
  }
  serverNow(): number {
    return performance.now() + (this.clockOffset ?? 0);
  }

  connect(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.intentionalClose = this.fatal = false;
    this.retries = 0;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    const attempt = ++this.connectionAttempt;
    this.setStatus('connecting');
    void Api.ensureTransport()
      .then(() => {
        if (attempt === this.connectionAttempt && !this.intentionalClose) this.open(false);
      })
      .catch((error) => {
        if (attempt !== this.connectionAttempt) return;
        this.setStatus('disconnected');
        this.rejectHandshake(
          error instanceof Error
            ? error
            : new Error('Guest authorization failed. Choose your callsign and retry.'),
        );
      });
    return this.connectPromise;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.listeners.status.forEach((fn) => fn(status));
  }

  private open(reconnecting: boolean): void {
    this.setStatus(reconnecting ? 'reconnecting' : 'connecting');
    const url = new URL('/arena/ws', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const grant = guestTransport.get();
    if (!grant) {
      this.setStatus('disconnected');
      this.rejectHandshake(
        new Error('Guest authorization expired. Re-enter your callsign to reconnect.'),
      );
      return;
    }
    const ws = (this.socket = new WebSocket(url, AUTH_SUBPROTOCOL));
    ws.addEventListener('open', () => {
      if (ws === this.socket && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'authenticate', token: grant.transportToken }));
    });
    this.handshakeTimer = window.setTimeout(() => ws.close(), 8000);
    ws.addEventListener('message', (event) => {
      if (ws !== this.socket || typeof event.data !== 'string' || event.data.length > 30000) return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        this.protocolFailure(ws);
        return;
      }
      const parsed = messageSchema.safeParse(value);
      if (!parsed.success) {
        this.protocolFailure(ws);
        return;
      }
      this.handle(parsed.data);
    });
    ws.addEventListener('close', () => {
      if (ws !== this.socket) return;
      window.clearTimeout(this.handshakeTimer);
      this.pending.forEach((p) => {
        window.clearTimeout(p.timer);
        p.reject(new Error('Connection lost. Please reconnect before retrying.'));
      });
      this.pending.clear();
      if (this.intentionalClose || this.fatal) {
        this.setStatus(this.intentionalClose ? 'idle' : 'disconnected');
        this.rejectHandshake(
          new Error('Unable to connect. Check the connection message and try again.'),
        );
        return;
      }
      if (!this.room) {
        this.setStatus('disconnected');
        this.rejectHandshake(
          new Error(
            'Unable to connect to the room server. Try again when the service is available.',
          ),
        );
        return;
      }
      if (this.retries >= 5) {
        this.setStatus('disconnected');
        this.rejectHandshake(new Error('Unable to connect to the room server.'));
        this.listeners.error.forEach((fn) =>
          fn('Connection lost. Your reconnect slot may expire; use Retry connection.'),
        );
        return;
      }
      this.setStatus('reconnecting');
      const delay = Math.min(4000, 500 * 2 ** this.retries++);
      this.reconnectTimer = window.setTimeout(() => this.open(true), delay);
    });
  }

  private protocolFailure(ws: WebSocket): void {
    this.fatal = true;
    this.listeners.error.forEach((fn) =>
      fn('Incompatible server message. Reload to use the current game version.'),
    );
    ws.close(4400, 'Protocol mismatch');
  }

  private updateClock(ms: number): void {
    const sample = ms - performance.now();
    this.clockOffset = this.clockOffset === null ? sample : this.clockOffset * 0.9 + sample * 0.1;
  }

  private handle(message: ServerMessage): void {
    if ('serverTimeMs' in message) this.updateClock(message.serverTimeMs);
    switch (message.type) {
      case 'welcome':
        this.playerId = message.playerId;
        window.clearTimeout(this.handshakeTimer);
        this.retries = 0;
        this.setStatus('connected');
        this.connectResolve?.();
        this.clearHandshake();
        break;
      case 'ping':
        this.socket?.send(JSON.stringify({ type: 'pong', nonce: message.nonce }));
        break;
      case 'room_state':
        this.room = message.room;
        this.listeners.room.forEach((fn) => fn(message.room));
        break;
      case 'snapshot':
        if (this.room?.id !== message.roomId) break;
        if (
          this.room.phase !== message.phase ||
          this.room.phaseEndsAtMs !== message.phaseEndsAtMs
        ) {
          this.room = { ...this.room, phase: message.phase, phaseEndsAtMs: message.phaseEndsAtMs };
          this.listeners.room.forEach((fn) => fn(this.room));
        }
        if (this.room) this.room.scores = message.scores;
        const local = message.players.find((p) => p.id === this.playerId);
        if (local) this.inputCounter = Math.max(this.inputCounter, local.ackSeq + 1);
        this.listeners.snapshot.forEach((fn) => fn(message));
        break;
      case 'combat_event':
        if (this.room?.id === message.roomId) this.listeners.combat.forEach((fn) => fn(message));
        break;
      case 'profile_update':
        this.listeners.profile.forEach((fn) => fn(message.profile));
        break;
      case 'ack': {
        const pending = this.pending.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pending.resolve();
          this.pending.delete(message.requestId);
        }
        break;
      }
      case 'error': {
        if (
          ['AUTH_REQUIRED', 'SESSION_IN_USE', 'SERVER_FULL', 'SERVER_UNAVAILABLE'].includes(
            message.code,
          ) &&
          this.status !== 'connected'
        ) {
          this.fatal = true;
          if (message.code === 'AUTH_REQUIRED') guestTransport.clear();
          this.rejectHandshake(new Error(message.message));
        }
        const pending = message.requestId ? this.pending.get(message.requestId) : undefined;
        if (pending && message.requestId) {
          window.clearTimeout(pending.timer);
          pending.reject(new Error(message.message));
          this.pending.delete(message.requestId);
        } else this.listeners.error.forEach((fn) => fn(message.message));
        break;
      }
      case 'room_closed':
        this.listeners.error.forEach((fn) => fn(message.message));
        break;
    }
  }

  action(type: Action, data: Record<string, unknown> = {}): Promise<void> {
    if (this.status !== 'connected' || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Not connected to the room server.'));
    const requestId = `r-${++this.requestCounter}`;
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The server did not acknowledge this action. Check your connection.'));
      }, 6000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ type, requestId, ...data }));
    });
  }

  input(intent: InputIntent): number | null {
    if (
      this.status !== 'connected' ||
      this.socket?.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount > 32_000
    )
      return null;
    const seq = this.inputCounter++;
    this.socket.send(JSON.stringify({ type: 'input', seq, ...intent }));
    return seq;
  }

  private clearHandshake(): void {
    this.connectPromise = this.connectResolve = this.connectReject = null;
  }
  private rejectHandshake(error: Error): void {
    this.connectReject?.(error);
    this.clearHandshake();
  }
  disconnect(): void {
    this.intentionalClose = true;
    this.connectionAttempt++;
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.handshakeTimer);
    this.socket?.close(1000, 'Left room');
    this.socket = null;
    this.pending.forEach((p) => {
      window.clearTimeout(p.timer);
      p.reject(new Error('Connection closed.'));
    });
    this.pending.clear();
    this.rejectHandshake(new Error('Connection closed.'));
    this.room = null;
    this.setStatus('idle');
  }
}
