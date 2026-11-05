/** A, B, C... as in C1 v2; past Z the block keeps its number. */
export function blockLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}
