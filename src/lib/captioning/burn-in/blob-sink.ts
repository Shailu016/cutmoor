import { CaptionError } from "../contracts";

/**
 * Collects the pieces an MP4 writer produces into one Blob without ever holding a second flat copy.
 *
 * Why not mediabunny's BufferTarget: it grows one big ArrayBuffer (and copies on growth), which on
 * a phone can double the memory of a long export. Here every piece becomes its own Blob, which
 * browsers may keep outside the JS heap, and the final file is the pieces glued together by
 * reference.
 *
 * The writer is not purely sequential: it also goes back to patch a few bytes (the size of the
 * media data box once it is known). So writes carry a byte position and later writes overwrite
 * earlier ones, exactly like a file. Overwriting splits the old pieces with Blob.slice, which is
 * cheap because slices share storage.
 */

interface Segment {
  start: number;
  end: number;
  blob: Blob;
}

export class SparseBlobBuilder {
  /** Non-overlapping, sorted by start. */
  private segments: Segment[] = [];

  /** Highest byte written so far plus one, i.e. the file length. */
  get size(): number {
    const last = this.segments[this.segments.length - 1];
    return last ? last.end : 0;
  }

  write(position: number, data: Uint8Array<ArrayBuffer>): void {
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new CaptionError("internal", `Bad write position ${position}.`);
    }
    if (data.byteLength === 0) return;
    const start = position;
    const end = position + data.byteLength;
    // The Blob constructor copies the bytes, so the caller may reuse its buffer afterwards.
    const added: Segment = { start, end, blob: new Blob([data]) };

    const last = this.segments[this.segments.length - 1];
    if (!last || last.end <= start) {
      this.segments.push(added);
      return;
    }

    // First segment that ends after `start`: everything before it is untouched.
    let lo = 0;
    let hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].end > start) hi = mid;
      else lo = mid + 1;
    }
    const first = lo;
    let stop = first;
    while (stop < this.segments.length && this.segments[stop].start < end) stop++;

    const replacement: Segment[] = [];
    if (stop > first) {
      const head = this.segments[first];
      if (head.start < start) {
        replacement.push({ start: head.start, end: start, blob: head.blob.slice(0, start - head.start) });
      }
    }
    replacement.push(added);
    if (stop > first) {
      const tail = this.segments[stop - 1];
      if (tail.end > end) {
        replacement.push({ start: end, end: tail.end, blob: tail.blob.slice(end - tail.start) });
      }
    }
    this.segments.splice(first, stop - first, ...replacement);
  }

  /** The finished file. Throws if there is a hole, because a file with a hole would not play. */
  toBlob(type: string): Blob {
    let expected = 0;
    for (const segment of this.segments) {
      if (segment.start !== expected) {
        throw new CaptionError("export", `The video writer left a gap in the file at byte ${expected}.`);
      }
      expected = segment.end;
    }
    return new Blob(
      this.segments.map((s) => s.blob),
      { type },
    );
  }
}
