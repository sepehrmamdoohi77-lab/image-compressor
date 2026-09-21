// Minimal typed event bus for decoupled UI <-> game communication.

export type GameEventType =
  | 'state-changed'
  | 'hitmarker'
  | 'kill'
  | 'player-damaged'
  | 'round-start'
  | 'round-complete'
  | 'victory'
  | 'defeat'
  | 'ammo'
  | 'noise'
  | 'objective'
  | 'pickup';

export interface GameEvent {
  type: GameEventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

type Listener = (e: GameEvent) => void;

export class EventBus {
  private listeners = new Map<GameEventType, Set<Listener>>();
  private anyListeners = new Set<Listener>();

  on(type: GameEventType, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  onAny(fn: Listener): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  off(type: GameEventType, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: GameEventType, data?: unknown): void {
    const e: GameEvent = { type, data };
    this.listeners.get(type)?.forEach((fn) => {
      try {
        fn(e);
      } catch (err) {
        // Never let a UI listener crash the game loop, but never hide it.
        console.error('[EventBus] listener error for', type, err);
      }
    });
    this.anyListeners.forEach((fn) => {
      try {
        fn(e);
      } catch (err) {
        console.error('[EventBus] any-listener error for', type, err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}
