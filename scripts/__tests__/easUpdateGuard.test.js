/**
 * Audit #305 A1/B1: guarded EAS Update publish.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../eas-update-guard');

describe('eas-update-guard', () => {
  it('requires --environment equal to the channel, a known channel, and a message', () => {
    expect(guard.checkArgs({ channel: 'production', environment: 'production', message: 'fix' })).toEqual([]);
    expect(guard.checkArgs({ channel: 'preview', environment: 'preview', message: 'fix' })).toEqual([]);
    expect(guard.checkArgs({ channel: 'production', message: 'fix' }).join()).toMatch(/--environment is required/);
    expect(guard.checkArgs({ channel: 'production', environment: 'preview', message: 'fix' }).join()).toMatch(/must equal --channel/);
    expect(guard.checkArgs({ channel: 'main', environment: 'main', message: 'fix' }).join()).toMatch(/--channel must be one of/);
    expect(guard.checkArgs({ channel: 'production', environment: 'production', message: ' ' }).join()).toMatch(/--message/);
  });

  it('parses both --k v and --k=v forms', () => {
    expect(guard.parseArgs(['--channel', 'production', '--environment=production', '--message', 'a b', '--dry-run'])).toEqual({
      channel: 'production',
      environment: 'production',
      message: 'a b',
      dryRun: true,
    });
  });

  it('the hide flag must be exactly "true" in the EAS environment', () => {
    expect(guard.checkEnvValue('true')).toEqual([]);
    for (const v of [undefined, '', 'false', '1', 'TRUE']) {
      expect(guard.checkEnvValue(v).join()).toMatch(/must be "true"/);
    }
  });

  it('the committed purchase-policy lock matches src/config/purchaseSurfaces.ts (edits need a reviewed lock bump)', () => {
    expect(guard.checkPolicyHash()).toEqual([]);
  });

  it('an edited gate (e.g. an OTA that removes it) is refused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-guard-'));
    try {
      fs.mkdirSync(path.join(dir, 'src', 'config'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      const root = path.resolve(__dirname, '..', '..');
      const src = fs.readFileSync(path.join(root, guard.POLICY_FILE), 'utf8');
      fs.copyFileSync(path.join(root, guard.LOCK_FILE), path.join(dir, guard.LOCK_FILE));
      fs.writeFileSync(
        path.join(dir, guard.POLICY_FILE),
        src.replace("if (flag !== false) return true;", 'return false;'),
      );
      expect(guard.checkPolicyHash(dir).join()).toMatch(/changed .* pins/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
