import { extractInviteCode } from '../inviteCodeInput';

describe('extractInviteCode', () => {
  it.each([
    ['GP-7K2Q', 'GP-7K2Q'],
    ['  gp-7k2q\n', 'GP-7K2Q'],
    ['https://app.trygrowthproject.com/join/GP-7K2Q', 'GP-7K2Q'],
    ['https://app.trygrowthproject.com/join/gp-abcd?utm_source=poster', 'GP-ABCD'],
    ['tgp://join/GP-ZZ99', 'GP-ZZ99'],
    ['https://app.trygrowthproject.com/join?code=GP-1234', 'GP-1234'],
    ['Scan or use code GP-CL1N to join Bradley', 'GP-CL1N'],
    ['Join me: https://app.trygrowthproject.com/join/GP-PNW1 thanks', 'GP-PNW1'],
    ['CLINIC2026', 'CLINIC2026'],
  ])('%p -> %p', (input, expected) => {
    expect(extractInviteCode(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['hello there friend'],
    ['https://example.com/some/other/path'],
    ['AB'],
    ['X'.repeat(40)],
    ['bad!code'],
  ])('rejects %p', (input) => {
    expect(extractInviteCode(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(extractInviteCode(undefined)).toBeNull();
    expect(extractInviteCode(42)).toBeNull();
  });
});
