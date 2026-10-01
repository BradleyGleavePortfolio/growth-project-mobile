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

const CANONICAL_SHA256: Record<string, string> = {
  'hero.jpg': 'c458e0c2f5a0eb25a47df416905da2aa40ce35846229dbcfab78c564fbd6e0ff',
  'neutral.png': 'e46f5efea743d87b4e4cb5be0fef66f7dc409e2ef1328dc8be2ca9d76f0d6f54',
  'neutral@2x.png': '27356d5095173163cd6dcab6919a5e3556b75f808f609fcf67817b883a6a3659',
  'neutral@3x.png': '3a6ee28279b7f66df3167d8cbd4b54d3c8b904b5cee86e9871d47bf7980a104d',
  'portrait.jpg': '028d7a4cbce53a6d5ec5efa3186f128ba0812a53a60c28836727b78a61c69487',
  'smile.png': 'e46f5efea743d87b4e4cb5be0fef66f7dc409e2ef1328dc8be2ca9d76f0d6f54',
  'smile@2x.png': '27356d5095173163cd6dcab6919a5e3556b75f808f609fcf67817b883a6a3659',
  'smile@3x.png': '3a6ee28279b7f66df3167d8cbd4b54d3c8b904b5cee86e9871d47bf7980a104d',
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
