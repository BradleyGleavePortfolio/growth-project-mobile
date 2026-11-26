/** LO-992R1 throwaway (ci lane only, never merge): prints the generated permission surface for both switch values. */
const { execFileSync } = require('child_process');
const path = require('path');

jest.setTimeout(600000);
const script = path.resolve(__dirname, '../../../scripts/ci-lo992r1-introspect.js');
const surface = (value) => {
  const env = { ...process.env };
  if (value === undefined) delete env.TGP_ANDROID_HEALTH_CONNECT; else env.TGP_ANDROID_HEALTH_CONNECT = value;
  return JSON.parse(execFileSync(process.execPath, [script], { env, cwd: path.dirname(script), maxBuffer: 64 * 1024 * 1024 }).toString());
};

describe.each([undefined, '1'])('LO-992R1 introspect (TGP_ANDROID_HEALTH_CONNECT=%s)', (value) => {
  test('prints the generated permission surface', () => {
    const r = surface(value);
    // eslint-disable-next-line no-console
    console.log(`LO992R1-INTROSPECT switch=${value} ${JSON.stringify(r)}`);
    expect(r.usesPermission.length).toBeGreaterThan(0);
  });
});
