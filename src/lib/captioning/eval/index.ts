/**
 * Public surface of the caption eval harness.
 *
 * Everything here is pure TypeScript: no DOM, no Node APIs, no network. The CLI in
 * `scripts/eval/run.mjs` is the file-IO wrapper, so the same scoring can be reused by tests or by an
 * in-app quality check without duplicating a single formula.
 */
export * from "./wer";
export * from "./timing";
export * from "./report";
export * from "./gold";
