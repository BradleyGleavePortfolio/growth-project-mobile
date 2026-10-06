/**
 * QR encoding for the coach Codes screen.
 *
 * Encoder: `toqr` (MIT, pure TypeScript, by the Expo team; already in the
 * lockfile because the Expo CLI prints its dev-server QR with it), so it runs
 * in Expo managed builds with no native module. Rendering is ours, on
 * react-native-svg (a direct dependency): one SVG path of dark modules.
 */
import { toQR } from 'toqr';

export interface QrMatrix {
  /** Modules per side (21 for version 1, +4 per version). */
  size: number;
  /** size * size cells, row-major; 1 = dark module. */
  cells: Uint8Array;
}

export function qrMatrix(text: string): QrMatrix {
  const cells = toQR(text);
  const size = Math.round(Math.sqrt(cells.length));
  return { size, cells };
}

/**
 * SVG path for the dark modules, offset by a quiet zone (4 modules, the QR
 * spec minimum) so scanners find the finder patterns. Runs of dark modules
 * in a row are merged into one rectangle to keep the path short.
 */
export function qrPath(m: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (m.cells[y * m.size + x] !== 1) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.size && m.cells[y * m.size + x] === 1) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join('');
}
