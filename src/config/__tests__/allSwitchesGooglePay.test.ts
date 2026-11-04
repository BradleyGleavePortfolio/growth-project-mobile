import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWalletConfig } from '../wallets';

test('LS-923 B2: all-on discovery enables the runtime Android Google Pay gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls923-wallet-'));
  const envFile = path.join(dir, 'env');
  const before = process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED;
  try {
    delete process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED;
    execFileSync(process.execPath, ['.github/all-switches-on/switches.js', 'find'], {
      env: { ...process.env, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: '' },
      stdio: 'pipe',
    });
    for (const line of fs.readFileSync(envFile, 'utf8').trim().split('\n')) {
      if (line.startsWith('EXPO_PUBLIC_GOOGLE_PAY_ENABLED=')) {
        process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = line.split('=')[1];
      }
    }
    const options = { os: 'android', currency: 'usd', publishableKey: '' };
    const discoveredWallet = resolveWalletConfig(options);
    process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = '1';
    expect(resolveWalletConfig(options).googlePay).toBeDefined();
    expect(discoveredWallet.googlePay).toBeDefined();
  } finally {
    if (before === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED;
    else process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
