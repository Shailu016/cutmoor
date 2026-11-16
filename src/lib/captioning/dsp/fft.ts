/**
 * FFT toolkit for the captioning DSP.
 *
 * Two things are needed downstream:
 *  - Whisper's STFT is a 400-point real DFT. 400 is not a power of two, so we cannot
 *    just zero-pad the frame to 512: that moves every frequency bin and measurably
 *    changes the mel spectrogram (mean error around 1e-1, far above the 1e-4 the
 *    oracle test allows). `createRealDft` therefore does an exact DFT of any length,
 *    using Bluestein's algorithm (a convolution evaluated with a power-of-two FFT).
 *  - The requested radix-2 real FFT (for example n = 512 from a 400-sample frame
 *    zero-padded) lives in `createRealFft`, with precomputed twiddles.
 *
 * Everything is double precision internally. Inputs may be Float32Array or
 * Float64Array, so callers can keep the audio as Float32 without a conversion copy.
 * Plans reuse their scratch buffers, which makes them cheap per frame but not safe to
 * use from two interleaved calls on the same plan (JavaScript is single threaded, so
 * that only matters if a caller re-enters the plan from a callback).
 */

/** Audio/sample input accepted by the plans. */
export type RealArray = Float32Array | Float64Array;

/** A complex transform. `transform` is the forward DFT, `inverse` includes the 1/N scale. */
export interface ComplexFftPlan {
  readonly size: number;
  /** Forward, in place. `re` and `im` must both have exactly `size` elements. */
  transform(re: Float64Array, im: Float64Array): void;
  /** Inverse, in place, scaled by 1/size. */
  inverse(re: Float64Array, im: Float64Array): void;
}

/** A real-input transform producing the non-redundant half spectrum. */
export interface RealFftPlan {
  readonly size: number;
  /** Number of frequency bins: floor(size / 2) + 1. */
  readonly bins: number;
  /**
   * Writes bins 0..bins-1 of the transform of `input[0..size-1]` into `re`/`im`.
   * Arrays shorter than `bins` are rejected; longer arrays are left with stale tails.
   */
  transform(input: RealArray, re: Float64Array, im: Float64Array): void;
}

const MAX_SIZE = 1 << 22;

function requireSize(size: number, label: string): void {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`${label}: size must be an integer >= 2, got ${size}`);
  }
  if (size > MAX_SIZE) {
    throw new Error(`${label}: size ${size} is larger than the supported maximum ${MAX_SIZE}`);
  }
}

function isPowerOfTwo(size: number): boolean {
  return (size & (size - 1)) === 0;
}

function nextPowerOfTwo(size: number): number {
  let result = 1;
  while (result < size) result *= 2;
  return result;
}

function requireBuffers(
  label: string,
  input: RealArray,
  size: number,
  re: Float64Array,
  im: Float64Array,
  bins: number,
): void {
  if (input.length < size) {
    throw new Error(`${label}: input has ${input.length} sample(s), need at least ${size}`);
  }
  if (re.length < bins || im.length < bins) {
    throw new Error(
      `${label}: output arrays have ${re.length}/${im.length} slot(s), need at least ${bins} each`,
    );
  }
}

/**
 * Iterative radix-2 Cooley-Tukey FFT. Twiddles and the bit-reversal table are
 * computed once per plan; the hot loop only does butterflies.
 */
export function createComplexFft(size: number): ComplexFftPlan {
  requireSize(size, "createComplexFft");
  if (!isPowerOfTwo(size)) {
    throw new Error(`createComplexFft: size must be a power of two, got ${size}`);
  }

  const tableLength = size >> 1;
  const cosTable = new Float64Array(tableLength);
  const sinTable = new Float64Array(tableLength);
  for (let k = 0; k < tableLength; k++) {
    const angle = (-2 * Math.PI * k) / size;
    cosTable[k] = Math.cos(angle);
    sinTable[k] = Math.sin(angle);
  }

  const bits = Math.round(Math.log2(size));
  const bitReverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let value = i;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit++) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    bitReverse[i] = reversed;
  }

  function run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    if (re.length !== size || im.length !== size) {
      throw new Error(
        `createComplexFft(${size}): transform needs arrays of exactly ${size} elements, got ${re.length}/${im.length}`,
      );
    }

    for (let i = 0; i < size; i++) {
      const j = bitReverse[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1;
      const twiddleStep = size / length;
      for (let start = 0; start < size; start += length) {
        for (let j = 0; j < half; j++) {
          const tableIndex = j * twiddleStep;
          const wr = cosTable[tableIndex];
          // The table stores sin(-2*pi*k/N); forward uses it as is, inverse flips it.
          const wi = inverse ? -sinTable[tableIndex] : sinTable[tableIndex];
          const even = start + j;
          const odd = even + half;
          const oddRe = re[odd];
          const oddIm = im[odd];
          const productRe = oddRe * wr - oddIm * wi;
          const productIm = oddRe * wi + oddIm * wr;
          re[odd] = re[even] - productRe;
          im[odd] = im[even] - productIm;
          re[even] += productRe;
          im[even] += productIm;
        }
      }
    }

    if (inverse) {
      const scale = 1 / size;
      for (let i = 0; i < size; i++) {
        re[i] *= scale;
        im[i] *= scale;
      }
    }
  }

  return {
    size,
    transform(re, im) {
      run(re, im, false);
    },
    inverse(re, im) {
      run(re, im, true);
    },
  };
}

/**
 * Radix-2 real FFT. Packs the even/odd samples into one complex FFT of half the
 * size, then untangles them; that is roughly half the work of a complex transform.
 */
export function createRealFft(size: number): RealFftPlan {
  requireSize(size, "createRealFft");
  if (!isPowerOfTwo(size)) {
    throw new Error(`createRealFft: size must be a power of two, got ${size}`);
  }

  const bins = (size >> 1) + 1;

  if (size === 2) {
    return {
      size,
      bins,
      transform(input, re, im) {
        requireBuffers("createRealFft(2)", input, 2, re, im, bins);
        re[0] = input[0] + input[1];
        im[0] = 0;
        re[1] = input[0] - input[1];
        im[1] = 0;
      },
    };
  }

  const half = size >> 1;
  const complex = createComplexFft(half);
  const packedRe = new Float64Array(half);
  const packedIm = new Float64Array(half);
  const cosW = new Float64Array(half);
  const sinW = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const angle = (-Math.PI * k) / half;
    cosW[k] = Math.cos(angle);
    sinW[k] = Math.sin(angle);
  }

  return {
    size,
    bins,
    transform(input, re, im) {
      requireBuffers(`createRealFft(${size})`, input, size, re, im, bins);

      for (let k = 0; k < half; k++) {
        packedRe[k] = input[2 * k];
        packedIm[k] = input[2 * k + 1];
      }
      complex.transform(packedRe, packedIm);

      // k = 0 and k = N/2 are their own mirror images.
      const dcRe = packedRe[0];
      const dcIm = packedIm[0];
      re[0] = dcRe + dcIm;
      im[0] = 0;
      re[half] = dcRe - dcIm;
      im[half] = 0;

      for (let k = 1; k < half; k++) {
        const zkRe = packedRe[k];
        const zkIm = packedIm[k];
        // conj(Z[half - k])
        const mirrorRe = packedRe[half - k];
        const mirrorIm = -packedIm[half - k];

        // even-sample DFT: (Zk + conj(mirror)) / 2
        const evenRe = (zkRe + mirrorRe) * 0.5;
        const evenIm = (zkIm + mirrorIm) * 0.5;

        // odd-sample DFT: (Zk - conj(mirror)) / (2i) = -i/2 * (Zk - conj(mirror))
        const diffRe = (zkRe - mirrorRe) * 0.5;
        const diffIm = (zkIm - mirrorIm) * 0.5;
        const oddRe = diffIm;
        const oddIm = -diffRe;

        const wr = cosW[k];
        const wi = sinW[k];
        re[k] = evenRe + (oddRe * wr - oddIm * wi);
        im[k] = evenIm + (oddRe * wi + oddIm * wr);
      }
    },
  };
}

/**
 * Exact real DFT of any length. Power-of-two sizes use `createRealFft`; other sizes
 * (Whisper's 400 in particular) use Bluestein's chirp-z algorithm, which turns the
 * DFT into a convolution and evaluates it with a power-of-two complex FFT.
 */
export function createRealDft(size: number): RealFftPlan {
  requireSize(size, "createRealDft");
  if (isPowerOfTwo(size)) return createRealFft(size);

  const bins = Math.floor(size / 2) + 1;
  const convolutionSize = nextPowerOfTwo(2 * size - 1);
  const complex = createComplexFft(convolutionSize);

  // chirp[n] = exp(-i*pi*n^2/N), the "b" factor of Bluestein.
  const chirpCos = new Float64Array(size);
  const chirpSin = new Float64Array(size);
  for (let n = 0; n < size; n++) {
    const angle = (-Math.PI * ((n * n) % (2 * size))) / size;
    chirpCos[n] = Math.cos(angle);
    chirpSin[n] = Math.sin(angle);
  }

  // c[d] = exp(+i*pi*d^2/N), laid out for a circular convolution and FFT'd once.
  const kernelRe = new Float64Array(convolutionSize);
  const kernelIm = new Float64Array(convolutionSize);
  for (let d = 0; d < size; d++) {
    const angle = (Math.PI * ((d * d) % (2 * size))) / size;
    const valueRe = Math.cos(angle);
    const valueIm = Math.sin(angle);
    kernelRe[d] = valueRe;
    kernelIm[d] = valueIm;
    if (d > 0) {
      kernelRe[convolutionSize - d] = valueRe;
      kernelIm[convolutionSize - d] = valueIm;
    }
  }
  complex.transform(kernelRe, kernelIm);

  const workRe = new Float64Array(convolutionSize);
  const workIm = new Float64Array(convolutionSize);

  return {
    size,
    bins,
    transform(input, re, im) {
      requireBuffers(`createRealDft(${size})`, input, size, re, im, bins);

      workRe.fill(0);
      workIm.fill(0);
      for (let n = 0; n < size; n++) {
        const sample = input[n];
        workRe[n] = sample * chirpCos[n];
        workIm[n] = sample * chirpSin[n];
      }

      complex.transform(workRe, workIm);

      for (let i = 0; i < convolutionSize; i++) {
        const aRe = workRe[i];
        const aIm = workIm[i];
        workRe[i] = aRe * kernelRe[i] - aIm * kernelIm[i];
        workIm[i] = aRe * kernelIm[i] + aIm * kernelRe[i];
      }

      complex.inverse(workRe, workIm);

      for (let k = 0; k < bins; k++) {
        const c = chirpCos[k];
        const s = chirpSin[k];
        const valueRe = workRe[k];
        const valueIm = workIm[k];
        re[k] = valueRe * c - valueIm * s;
        im[k] = valueRe * s + valueIm * c;
      }
    },
  };
}
