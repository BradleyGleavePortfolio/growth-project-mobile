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
    ['Join me: https://app.trygrowthproject.com/join/GP-TEST1 thanks', 'GP-TEST1'],
    ['CLINIC2026', 'CLINIC2026'],
    // B5: full backend dash pattern, whole-token normalisation
    ['GP-AB-CD', 'GP-AB-CD'],
    ['Use GP-AB-CD-EF.', 'GP-AB-CD-EF'],
    ['"GP-7K2Q"', 'GP-7K2Q'],
    ['tgp://join/CLINIC2026', 'CLINIC2026'],
    ['https://app.trygrowthproject.com/join/GP-7K2Q/', 'GP-7K2Q'],
    ['https://app.trygrowthproject.com/join/gp%2D7k2q', 'GP-7K2Q'],
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
    // B5: never truncate to a valid-looking prefix
    ['GP-AB!garbage'],
    ['GP-' + 'A'.repeat(40)],
    ['use code GP-' + 'A'.repeat(40) + ' please'],
    ['Code: GP-AB!garbage today'],
    ['https://app.trygrowthproject.com/join/GP-AB%21'],
    ['https://app.trygrowthproject.com/join/%E0%A4%A'],
    ['https://app.trygrowthproject.com/join/GP-AB!x'],
    ['tgp://join/'],
    ['---'],
  ])('rejects %p', (input) => {
    expect(extractInviteCode(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(extractInviteCode(undefined)).toBeNull();
    expect(extractInviteCode(42)).toBeNull();
  });
});
