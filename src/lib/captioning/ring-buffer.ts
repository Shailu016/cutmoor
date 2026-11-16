/**
 * A fixed-size ring buffer of audio samples. The media worker pushes decoded 16 kHz chunks
 * in as they arrive and the VAD reads them out in its own frame size, so neither side ever
 * allocates or copies the whole file.
 *
 * The capacity is rounded up to a power of two so an index wraps with a bit mask instead of
 * a modulo. `write` never overwrites unread audio: it stores what fits and returns how much
 * it took, so the producer can wait instead of silently losing speech.
 */
export class RingBuffer {
  private readonly data: Float32Array;
  private readonly mask: number;
  /** Total samples ever written and read. Their difference is the fill level, and they never wrap. */
  private written = 0;
  private consumed = 0;

  constructor(minimumCapacity: number) {
    if (!Number.isInteger(minimumCapacity) || minimumCapacity < 1) {
      throw new Error("A ring buffer needs a capacity of at least 1 sample.");
    }
    // Capacity is in samples of 4 bytes each, so 2 ** 28 samples is 1 GiB.
    if (minimumCapacity > 2 ** 28) throw new Error("That ring buffer would be larger than 1 GiB.");
    let size = 1;
    while (size < minimumCapacity) size <<= 1;
    this.data = new Float32Array(size);
    this.mask = size - 1;
  }

  get capacity(): number {
    return this.data.length;
  }

  /** Samples waiting to be read. */
  get available(): number {
    return this.written - this.consumed;
  }

  /** Samples that can still be written. */
  get free(): number {
    return this.capacity - this.available;
  }

  /** Stores as much of `samples` as fits. Returns how many were stored. */
  write(samples: Float32Array): number {
    const count = Math.min(samples.length, this.free);
    const start = this.written & this.mask;
    const firstPart = Math.min(count, this.capacity - start);
    this.data.set(samples.subarray(0, firstPart), start);
    if (count > firstPart) this.data.set(samples.subarray(firstPart, count), 0);
    this.written += count;
    return count;
  }

  /** Copies up to `into.length` samples out without consuming them, oldest first. Returns the count. */
  peek(into: Float32Array): number {
    const count = Math.min(into.length, this.available);
    const start = this.consumed & this.mask;
    const firstPart = Math.min(count, this.capacity - start);
    into.set(this.data.subarray(start, start + firstPart), 0);
    if (count > firstPart) into.set(this.data.subarray(0, count - firstPart), firstPart);
    return count;
  }

  /** Copies up to `into.length` samples out and consumes them. Returns the count. */
  read(into: Float32Array): number {
    const count = this.peek(into);
    this.consumed += count;
    return count;
  }

  /** Drops up to `count` of the oldest samples without copying them. Returns how many were dropped. */
  skip(count: number): number {
    const dropped = Math.max(0, Math.min(Math.floor(count), this.available));
    this.consumed += dropped;
    return dropped;
  }

  clear(): void {
    this.consumed = this.written;
  }
}
