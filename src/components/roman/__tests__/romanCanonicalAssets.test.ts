/**
 * Pins every bundled Roman asset to the canonical art (older Black butler,
 * black three-piece suit) derived from tgp-agent-context/design/roman/.
 * If this fails, someone replaced Roman's face. Do not update the hashes
 * without an owner decision recorded in tgp-agent-context.
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROMAN_DIR = join(__dirname, '../../../../assets/roman');

// B27 (ROMAN-ROOM-133): the face crops are re-derived from portrait.jpg as the
// 330 px square at (80, 10), circle-masked at 64/128/192 px, so the whole
// crown shows with headroom (the earlier crop cut through Roman's hair).
const CANONICAL_SHA256: Record<string, string> = {
  'hero.jpg': 'c458e0c2f5a0eb25a47df416905da2aa40ce35846229dbcfab78c564fbd6e0ff',
  'neutral.png': '22788a1bc8aa881de8b3cb4ff8dad17432b45ca4cc9020fa016b2edb8f4595e6',
  'neutral@2x.png': 'a72775533860de4bc589b60958a4d210e207b66191e408586a9386748388dc4e',
  'neutral@3x.png': '93ff1092fbc7c5638b513bd711883cae166f270689db591f4ab2c537df6248a2',
  'portrait.jpg': '028d7a4cbce53a6d5ec5efa3186f128ba0812a53a60c28836727b78a61c69487',
  'smile.png': '22788a1bc8aa881de8b3cb4ff8dad17432b45ca4cc9020fa016b2edb8f4595e6',
  'smile@2x.png': 'a72775533860de4bc589b60958a4d210e207b66191e408586a9386748388dc4e',
  'smile@3x.png': '93ff1092fbc7c5638b513bd711883cae166f270689db591f4ab2c537df6248a2',
  'welcome.jpg': 'bb5a62ecbf8fd9fd13e09a0234f2a3de7d1f4f1aaea5a76f54e19aa43a6128bc',
};

describe('Roman canonical assets', () => {
  it('ships exactly the canonical file set', () => {
    expect(readdirSync(ROMAN_DIR).sort()).toEqual(Object.keys(CANONICAL_SHA256).sort());
  });

  it.each(Object.entries(CANONICAL_SHA256))('%s matches the canonical art', (file, sha) => {
    const digest = createHash('sha256').update(readFileSync(join(ROMAN_DIR, file))).digest('hex');
    expect(digest).toBe(sha);
  });
});
