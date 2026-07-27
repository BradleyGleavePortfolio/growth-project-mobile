/**
 * Importer v0.3 flag declaration + kill-switch independence (M5-B).
 *
 * Two guarantees this suite exists to hold:
 *   1. Both importer flags are DECLARED in .env.example. `EXPO_PUBLIC_FF_*`
 *      values are baked in at build time, so an undeclared flag is invisible to
 *      whoever configures an EAS profile — the surface silently stays off (or,
 *      worse, someone guesses the name wrong and believes it is on).
 *   2. The review READ has its OWN switch. Previously the reconstruct read was
 *      gated on `extensionImport` alone, so the only way to stop a misbehaving
 *      poll against a still-moving backend contract was to also stop every
 *      coach mid-pairing. `importReview` can now be cut on its own.
 *
 * Both default OFF unconditionally (never `isDev`): a dev build must not reach
 * a live import endpoint by accident.
 */
import * as fs from 'fs';
import * as path from 'path';
import { featureFlags } from '../featureFlags';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_EXAMPLE = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
const FLAGS_SRC = fs.readFileSync(path.join(__dirname, '..', 'featureFlags.ts'), 'utf8');
const RECONSTRUCT_HOOK = fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'hooks', 'useReconstructCounts.ts'),
  'utf8',
);

describe('importer flags default OFF', () => {
  it('extensionImport is false at runtime', () => {
    expect(featureFlags.extensionImport).toBe(false);
  });

  it('importReview is false at runtime', () => {
    expect(featureFlags.importReview).toBe(false);
  });

  it('importReview reads its env var with a hard false default, not isDev', () => {
    expect(FLAGS_SRC).toMatch(
      /importReview:\s*readFlag\(\s*'EXPO_PUBLIC_FF_IMPORT_REVIEW',\s*false\s*\)/,
    );
  });
});

describe('both importer flags are declared in .env.example', () => {
  it.each([
    'EXPO_PUBLIC_FF_EXTENSION_IMPORT',
    'EXPO_PUBLIC_FF_IMPORT_REVIEW',
  ])('declares %s with a false default', (key) => {
    expect(ENV_EXAMPLE).toMatch(new RegExp(`^${key}=false$`, 'm'));
  });
});

describe('the review read is gated on BOTH switches', () => {
  it('requires extensionImport AND importReview AND a coach id', () => {
    expect(RECONSTRUCT_HOOK).toMatch(
      /featureFlags\.extensionImport\s*&&\s*featureFlags\.importReview\s*&&\s*!!coachId/,
    );
  });

  it('leaves pairing itself gated on extensionImport only', () => {
    const pairingHook = fs.readFileSync(
      path.join(REPO_ROOT, 'src', 'hooks', 'useExtensionPairing.ts'),
      'utf8',
    );
    expect(pairingHook).toMatch(/featureFlags\.extensionImport/);
    expect(pairingHook).not.toMatch(/featureFlags\.importReview/);
  });
});

describe('EXPO_PUBLIC_FF_IMPORT_REVIEW resolves from the environment', () => {
  const KEY = 'EXPO_PUBLIC_FF_IMPORT_REVIEW';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    jest.resetModules();
  });

  function loadFlag(): boolean {
    let value = false;
    jest.isolateModules(() => {
      value = require('../featureFlags').featureFlags.importReview;
    });
    return value;
  }

  it.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])(
    'is ON for the truthy string %p',
    (raw) => {
      process.env[KEY] = raw;
      expect(loadFlag()).toBe(true);
    },
  );

  it.each(['false', '0', 'no', 'off', ''])(
    'is OFF for the falsy string %p',
    (raw) => {
      process.env[KEY] = raw;
      expect(loadFlag()).toBe(false);
    },
  );

  it('is OFF when the env var is absent entirely', () => {
    delete process.env[KEY];
    expect(loadFlag()).toBe(false);
  });
});
