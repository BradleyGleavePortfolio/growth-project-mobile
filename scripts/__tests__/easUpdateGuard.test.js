/**
 * Audit #305 A1/B1: guarded EAS Update publish.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../eas-update-guard');

describe('eas-update-guard', () => {
  it('requires a known eas.json channel, --environment equal to that profile\'s environment, and a message', () => {
    expect(guard.checkArgs({ channel: 'production', environment: 'production', message: 'fix' })).toEqual([]);
    expect(guard.checkArgs({ channel: 'preview', environment: 'preview', message: 'fix' })).toEqual([]);
    expect(guard.checkArgs({ channel: 'clinic', environment: 'production', message: 'fix' })).toEqual([]);
    expect(guard.checkArgs({ channel: 'production', message: 'fix' }).join()).toMatch(/--environment is required/);
    expect(guard.checkArgs({ channel: 'production', environment: 'preview', message: 'fix' }).join()).toMatch(/must equal eas\.json build\.production\.environment/);
    expect(guard.checkArgs({ channel: 'clinic', environment: 'clinic', message: 'fix' }).join()).toMatch(/must equal eas\.json build\.clinic\.environment \("production"\)/);
    expect(guard.checkArgs({ channel: 'main', environment: 'main', message: 'fix' }).join()).toMatch(/--channel must be one of clinic, preview, production/);
    expect(guard.checkArgs({ channel: 'production', environment: 'production', message: ' ' }).join()).toMatch(/--message/);
  });

  it('refuses a channel shared by two profiles', () => {
    const channels = {
      production: { profiles: ['production', 'clinic'], profile: 'production', environment: 'production', env: {} },
    };
    expect(guard.checkArgs({ channel: 'production', environment: 'production', message: 'fix' }, channels).join()).toMatch(/used by 2 eas\.json profiles/);
  });

  it('reads the clinic channel from eas.json with the production flags merged under the clinic flags', () => {
    const c = guard.loadChannels();
    expect(Object.keys(c).sort()).toEqual(['clinic', 'preview', 'production']);
    expect(c.clinic.environment).toBe('production');
    expect(c.clinic.env.EXPO_PUBLIC_FF_CLIENT_TUTORIAL).toBe('true');
    expect(c.clinic.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES).toBe('true');
    expect(c.clinic.env.TGP_ANDROID_HEALTH_CONNECT).toBe('0');
    expect(c.production.env.EXPO_PUBLIC_FF_CLIENT_TUTORIAL).toBeUndefined();
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

    // A remote environment that has every kind:"required" name and no
    // conflicting copies of eas.json profile values.
    const REMOTE_OK = [
      'Environment: production',
      'EXPO_PUBLIC_API_URL=https://api.example.test/api',
      'EXPO_PUBLIC_SUPABASE_URL=https://abc.supabase.co',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)',
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_abc',
      `${F}=true`,
    ].join('\n');
    const listOk = (scope) => (scope === 'project' ? { status: 0, stdout: REMOTE_OK } : { status: 0, stdout: 'No variables found for this environment.' });

    function harness(lookup, list = listOk) {
      const calls = [];
      const run = jest.fn((cmd, args, opts) => {
        calls.push({ cmd, args, env: opts && opts.env });
        if (args[1] === 'env:get') return lookup(opts);
        if (args[1] === 'env:list') return list(args[args.indexOf('--scope') + 1], args[2]);
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
      expect(h.calls.map((c) => c.args[1])).toEqual(['env:get', 'env:list', 'env:list']);
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

    describe('build parity: the update ships the env the binary was built with (S-RELEASE-MOB)', () => {
      const CLINIC = ['--channel', 'clinic', '--environment', 'production', '--message', 'fix'];
      const okFlag = ok(`${F}=true\n`);

      it('clinic publish: profile env (with clinic flags) reaches the child, stray local EXPO_PUBLIC_* do not, the flag comes from EAS', () => {
        const h = harness(okFlag);
        const parent = { PATH: '/bin', EXPO_PUBLIC_FF_COMMUNITY_DM: 'true', EXPO_PUBLIC_API_URL: 'http://localhost:3000/api', [F]: 'true' };
        expect(guard.main(CLINIC, { run: h.run, env: parent, log: () => undefined })).toBe(0);
        const pub = h.calls.find((c) => c.args[1] === 'update');
        expect(pub.args).toEqual(['eas-cli', 'update', '--channel', 'clinic', '--environment', 'production', '--message', 'fix']);
        expect(pub.env.PATH).toBe('/bin');
        expect(pub.env.EXPO_PUBLIC_FF_CLIENT_TUTORIAL).toBe('true');
        expect(pub.env.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING).toBe('true');
        expect(pub.env.EXPO_PUBLIC_FF_COMMUNITY_DM).toBe('false');
        expect(pub.env.TGP_ANDROID_HEALTH_CONNECT).toBe('0');
        expect(Object.prototype.hasOwnProperty.call(pub.env, 'EXPO_PUBLIC_API_URL')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(pub.env, F)).toBe(false);
        const lists = h.calls.filter((c) => c.args[1] === 'env:list').map((c) => c.args);
        expect(lists).toEqual([
          ['eas-cli', 'env:list', 'production', '--format', 'short', '--scope', 'project'],
          ['eas-cli', 'env:list', 'production', '--format', 'short', '--scope', 'account'],
        ]);
      });

      it.each([
        ['a project variable turns a clinic flag off', (scope) => ({ status: 0, stdout: scope === 'project' ? `${REMOTE_OK}\nEXPO_PUBLIC_FF_CLIENT_TUTORIAL=false` : '' }), /EXPO_PUBLIC_FF_CLIENT_TUTORIAL is "true" in eas\.json build\.clinic\.env .* project-scope EAS variable in "production" holds "false"/],
        ['an account variable differs', (scope) => ({ status: 0, stdout: scope === 'account' ? 'EXPO_PUBLIC_FF_COMMUNITY_DM=true' : REMOTE_OK }), /EXPO_PUBLIC_FF_COMMUNITY_DM .* account-scope EAS variable .* holds "true"/],
        ['a masked copy cannot be compared', (scope) => ({ status: 0, stdout: scope === 'project' ? `${REMOTE_OK}\nEXPO_PUBLIC_FF_COACH_BRIEF=***** (This is a sensitive env variable.)` : '' }), /EXPO_PUBLIC_FF_COACH_BRIEF .* holds a masked value/],
        ['a duplicate copy', (scope) => ({ status: 0, stdout: scope === 'project' ? `${REMOTE_OK}\nTGP_ANDROID_HEALTH_CONNECT=0\nTGP_ANDROID_HEALTH_CONNECT=1` : '' }), /TGP_ANDROID_HEALTH_CONNECT .* holds 2 records/],
        ['the project list fails', (scope) => (scope === 'project' ? { status: 1, stdout: '', stderr: 'auth' } : { status: 0, stdout: '' }), /env:list production --scope project failed/],
        ['the account list cannot spawn', (scope) => (scope === 'account' ? { status: null, error: new Error('ENOENT') } : { status: 0, stdout: REMOTE_OK }), /env:list production --scope account failed/],
        ['a required name is missing everywhere', () => ({ status: 0, stdout: REMOTE_OK.replace(/EXPO_PUBLIC_API_URL=.*\n/, '') }), /EXPO_PUBLIC_API_URL is kind "required" .* set neither in EAS environment "production" nor in eas\.json build\.clinic\.env/],
      ])('refuses and never publishes: %s', (_label, list, re) => {
        const logs = [];
        const h = harness(okFlag, list);
        expect(guard.main(CLINIC, { run: h.run, env: { PATH: '/bin' }, log: (m) => logs.push(m) })).toBe(1);
        expect(h.published()).toBe(false);
        expect(logs.some((m) => re.test(m))).toBe(true);
      });

      it('an identical remote copy of a profile value is accepted', () => {
        const h = harness(okFlag, (scope) => ({ status: 0, stdout: scope === 'project' ? `${REMOTE_OK}\nEXPO_PUBLIC_FF_CLIENT_TUTORIAL=true` : '' }));
        expect(guard.main(CLINIC, { run: h.run, env: {}, log: () => undefined })).toBe(0);
        expect(h.published()).toBe(true);
      });

      it('parseEnvList reads bold names, skips headers and keeps duplicates', () => {
        const m = guard.parseEnvList(`Environment: production\n\u001b[1mA_B\u001b[22m=x=y\nA_B=z\nNo variables found`);
        expect([...m.entries()]).toEqual([['A_B', ['x=y', 'z']]]);
      });
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

