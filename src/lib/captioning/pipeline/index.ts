/**
 * Public surface of the captioning pipeline. `stand-in.ts` (the fake engine) is deliberately NOT
 * exported here, so production code that only imports this file never bundles it.
 */
export { createCaptionPipeline } from "./pipeline";
export type { PipelineTuning } from "./pipeline";
export { assembleWindowAudio } from "./assemble";
export type { PcmSource } from "./assemble";
export { PcmStore } from "./pcm-store";
export { StreamingPacker } from "./streaming-packer";
export { WordAccumulator } from "./word-accumulator";
export { createUniformAligner, uniformAlign, UNIFORM_CONFIDENCE } from "./uniform-aligner";
export { createAttentionAligner, wordsFromModelTimes } from "./attention-aligner";
