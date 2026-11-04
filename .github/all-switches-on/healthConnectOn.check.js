import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Platform } from 'react-native';

it('LS-923 B1: discovery enables the runtime Android Health Connect gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls923-hc-'));
  const envFile = path.join(dir, 'env');
  const before = { ...process.env };
  const platform = Platform.OS;
  try {
    execFileSync(process.execPath, ['.github/all-switches-on/switches.js', 'find'], {
      env: { ...process.env, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: '' },
      stdio: 'pipe',
    });
    for (const row of fs.readFileSync(envFile, 'utf8').trim().split('\n')) {
      const split = row.indexOf('=');
      process.env[row.slice(0, split)] = row.slice(split + 1);
    }
    expect(process.env.TGP_ANDROID_HEALTH_CONNECT).toBe('1');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    const { isAndroidHealthConnectEnabled } = require('../../src/config/healthConnect');
    expect(isAndroidHealthConnectEnabled()).toBe(true);
  } finally {
    process.env = before;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
