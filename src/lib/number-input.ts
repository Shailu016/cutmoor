/** True for text that could still become a number as someone types it: "", "7", "7.", "7.5". */
export function isNumberDraft(text: string): boolean {
  return /^\d*\.?\d*$/.test(text);
}

/** The number in a field, or null while it is empty, unfinished, or below the minimum. */
export function parseNumberInput(text: string, min: number): number | null {
  if (!/\d/.test(text) || !isNumberDraft(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= min ? value : null;
}
