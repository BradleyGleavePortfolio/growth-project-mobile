import { qrMatrix, qrPath } from '../qrMatrix';

const URL = 'https://app.trygrowthproject.com/join/GP-7XQ9KM';

/** The 7x7 finder pattern: dark ring, light ring, dark 3x3 centre. */
function finderAt(m: ReturnType<typeof qrMatrix>, x0: number, y0: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = x === 0 || y === 0 || x === 6 || y === 6;
      const centre = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const want = ring || centre ? 1 : 0;
      if (m.cells[(y0 + y) * m.size + (x0 + x)] !== want) return false;
    }
  }
  return true;
}

describe('qrMatrix', () => {
  it('encodes a join link as a square QR with the three finder patterns', () => {
    const m = qrMatrix(URL);
    // 47 bytes fits version 3 (29 modules); verified to decode back to URL with OpenCV QRCodeDetector.
    expect(m.size).toBe(29);
    expect(m.cells.length).toBe(29 * 29);
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, m.size - 7, 0)).toBe(true);
    expect(finderAt(m, 0, m.size - 7)).toBe(true);
    expect(finderAt(m, m.size - 7, m.size - 7)).toBe(false);
  });

  it('different codes give different matrices', () => {
    expect(Array.from(qrMatrix(URL).cells)).not.toEqual(
      Array.from(qrMatrix('https://app.trygrowthproject.com/join/GP-ABC234').cells),
    );
  });

  it('qrPath draws every dark module once, offset by the quiet zone', () => {
    const m = qrMatrix(URL);
    const d = qrPath(m, 4);
    expect(d.startsWith('M4 4h7v1h-7z')).toBe(true); // top row of the top-left finder
    const darkCount = Array.from(m.cells).filter((v) => v === 1).length;
    const drawn = [...d.matchAll(/h(\d+)v1/g)].reduce((a, r) => a + Number(r[1]), 0);
    expect(drawn).toBe(darkCount);
  });
});
