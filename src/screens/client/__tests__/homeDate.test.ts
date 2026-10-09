import { homeDateLine } from '../homeDate';

// B34: the owner saw "THURSDAY, THE EIGHTH." on Home (10-08).
describe('homeDateLine', () => {
  const thursday = new Date(2026, 9, 8, 9, 30);

  it('reads weekday, day and month in the locale order, with no ordinal words or full stop', () => {
    const gb = homeDateLine(thursday, 'en-GB');
    expect(gb).toMatch(/^Thursday,? 8 October$/);
    expect(homeDateLine(thursday, 'en-US')).toBe('Thursday, October 8');
    for (const line of [gb, homeDateLine(thursday)]) {
      expect(line).not.toMatch(/\bthe\b|eighth|\.$/i);
      expect(line).toContain('8');
    }
  });

  it('follows another locale rather than forcing English', () => {
    expect(homeDateLine(thursday, 'fr-FR')).toMatch(/^jeudi 8 octobre$/);
  });

  it('covers every day of a month without words', () => {
    for (let day = 1; day <= 31; day += 1) {
      expect(homeDateLine(new Date(2026, 9, day), 'en-GB')).toMatch(new RegExp(`\\b${day} October$`));
    }
  });
});
