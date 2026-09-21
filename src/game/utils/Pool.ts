// Generic object pool to avoid per-frame allocation in hot systems.

export class Pool<T> {
  private items: T[] = [];
  private create: () => T;
  private reset?: (item: T) => void;

  constructor(create: () => T, reset?: (item: T) => void, preallocate = 0) {
    this.create = create;
    this.reset = reset;
    for (let i = 0; i < preallocate; i++) this.items.push(create());
  }

  acquire(): T {
    const item = this.items.pop();
    return item !== undefined ? item : this.create();
  }

  release(item: T): void {
    if (this.reset) this.reset(item);
    this.items.push(item);
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
