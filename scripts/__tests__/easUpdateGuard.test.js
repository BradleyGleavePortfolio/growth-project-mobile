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

  describe('main() orchestration (re-audit B2): the remote EAS record is the only source of truth', () => {
    const ARGV = ['--channel', 'production', '--environment', 'production', '--message', 'fix'];
    const F = guard.FLAG;

    function harness(lookup) {
      const calls = [];
      const run = jest.fn((cmd, args, opts) => {
        calls.push({ cmd, args, env: opts && opts.env });
        if (args[1] === 'env:get') return lookup(opts);
        if (args[1] === 'update') return { status: 0 };
        throw new Error(`unexpected command ${args.join(' ')}`);
      });
      const published = () => calls.some((c) => c.args[1] === 'update');
      return { run, calls, published };
    }
    const ok = (stdout, stderr = '') => () => ({ status: 0, stdout, stderr });

    it.each([
      ['remote missing (eas-cli logs "not found" and exits 0), local true', ok('', 'Variable with name "X" not found')],
      ['remote missing with empty output, local true', ok('')],
      ['remote empty value, local true', ok(`${F}=\n`)],
      ['remote false, local true', ok(`${F}=false\n`)],
      ['remote masked (sensitive), local true', ok(`${F}=***** (This is a sensitive env variable.)\n`)],
      ['duplicate/ambiguous records, local true', ok(`${F}=true\n${F}=false\n`)],
      ['lookup failed (secret / network / auth)', () => ({ status: 1, stdout: '', stderr: 'boom' })],
      ['lookup could not spawn', () => ({ status: null, error: new Error('ENOENT') })],
    ])('refuses and never publishes: %s', (_label, lookup) => {
      const h = harness(lookup);
      const code = guard.main(ARGV, { run: h.run, env: { [F]: 'true', PATH: '/bin' }, log: () => undefined });
      expect(code).toBe(1);
      expect(h.published()).toBe(false);
    });

    it('the lookup child never sees a locally exported flag, and the query names the environment explicitly', () => {
      let seenEnv;
      const h = harness((opts) => {
        seenEnv = opts.env;
        return { status: 0, stdout: `${F}=true\n` };
      });
      expect(guard.main(ARGV, { run: h.run, env: { [F]: 'true', PATH: '/bin' }, log: () => undefined })).toBe(0);
      expect(seenEnv).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(seenEnv, F)).toBe(false);
      const get = h.calls.find((c) => c.args[1] === 'env:get');
      expect(get.args).toEqual(['eas-cli', 'env:get', 'production', '--variable-name', F, '--format', 'short', '--scope', 'project', '--non-interactive']);
    });

    it('publishes only after a single remote NAME=true record, with --environment, and without the local flag', () => {
      const h = harness(ok(`\u001b[1m${F}\u001b[22m=true\n`));
      expect(guard.main(ARGV, { run: h.run, env: { PATH: '/bin' }, log: () => undefined })).toBe(0);
      const pub = h.calls.find((c) => c.args[1] === 'update');
      expect(pub.args).toEqual(['eas-cli', 'update', '--channel', 'production', '--environment', 'production', '--message', 'fix']);
      expect(Object.prototype.hasOwnProperty.call(pub.env, F)).toBe(false);
    });

    it('--dry-run runs the remote check but never publishes', () => {
      const h = harness(ok(`${F}=true\n`));
      expect(guard.main([...ARGV, '--dry-run'], { run: h.run, env: {}, log: () => undefined })).toBe(0);
      expect(h.calls.map((c) => c.args[1])).toEqual(['env:get']);
    });

    it('mismatched environment and a local non-true flag refuse before any EAS call', () => {
      for (const [argv, env] of [
        [['--channel', 'production', '--environment', 'preview', '--message', 'x'], {}],
        [['--channel', 'production', '--message', 'x'], {}],
        [ARGV, { [F]: 'false' }],
      ]) {
        const h = harness(ok(`${F}=true\n`));
        expect(guard.main(argv, { run: h.run, env, log: () => undefined })).toBe(1);
        expect(h.calls).toEqual([]);
      }
    });

    it('a modified gate (hash mismatch) refuses before any EAS call', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-guard-main-'));
      try {
        fs.mkdirSync(path.join(dir, 'src', 'config'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        const root = path.resolve(__dirname, '..', '..');
        const src = fs.readFileSync(path.join(root, guard.POLICY_FILE), 'utf8');
        fs.copyFileSync(path.join(root, guard.LOCK_FILE), path.join(dir, guard.LOCK_FILE));
        fs.writeFileSync(path.join(dir, guard.POLICY_FILE), src.replace('IOS_P2P_ONLY_MIN_NATIVE_BUILD = 6;', 'IOS_P2P_ONLY_MIN_NATIVE_BUILD = 600;'));
        const h = harness(ok(`${F}=true\n`));
        expect(guard.main(ARGV, { run: h.run, env: {}, root: dir, log: () => undefined })).toBe(1);
        expect(h.calls).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

