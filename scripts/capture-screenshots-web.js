#!/usr/bin/env node
// Existing capture driver: real Expo app, not a reconstructed screen.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ts = require('typescript');
const manifest = { exports: {} };
const file = path.resolve(__dirname, '../src/screenshots/screens.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
require('node:vm').runInNewContext(code, { exports: manifest.exports });
const { SCREENSHOT_TARGETS, SCREENSHOT_SIZES, SCREENSHOT_CAPTIONS } = manifest.exports;
if (process.argv.includes('--list')) {
  console.log(SCREENSHOT_TARGETS.map((target) => target.slug).join('\n'));
  process.exit(0);
}

function profileEnv(name) {
  const profile = require('../eas.json').build[name];
  if (!profile) throw new Error(`Unknown store profile: ${name}`);
  return { ...(profile.extends ? profileEnv(profile.extends) : {}), ...profile.env };
}

(async () => {
  const { chromium, devices } = require('playwright');
  const out = path.resolve(process.env.SCREENSHOT_OUT_DIR || 'screenshots/web');
  fs.mkdirSync(out, { recursive: true });
  const url = process.env.SCREENSHOT_WEB_URL || 'http://localhost:8081';
  const env = { ...profileEnv(process.env.SCREENSHOT_PROFILE || 'production'), ...process.env,
    NODE_ENV: 'development', EXPO_PUBLIC_SCREENSHOT_MODE: '1',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:9', EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'screenshot-mode', CI: '1' };
  const log = fs.openSync(path.join(out, 'metro.log'), 'w');
  const server = process.env.SCREENSHOT_WEB_URL ? null : spawn(process.execPath,
    [require.resolve('expo/bin/cli'), 'start', '--web', '--port', '8081'], { env, stdio: ['ignore', log, log] });
  let browser;
  try {
    let available = false;
    for (let i = 0; i < 120; i++) {
      if (await fetch(url).then((r) => r.ok).catch(() => false)) { available = true; break; }
      if (server?.exitCode != null) throw new Error('Expo exited; see metro.log');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!available) throw new Error('Expo did not start; see metro.log');
    browser = await chromium.launch({ headless: true });
    const evidence = [];
    for (const size of SCREENSHOT_SIZES) {
      for (const target of SCREENSHOT_TARGETS) {
        const context = await browser.newContext({ ...devices['iPhone 13 Pro Max'],
          viewport: { width: size.width / 3, height: size.height / 3 }, deviceScaleFactor: 3 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
        page.on('console', (message) => {
          if (message.text().includes('[screenshot mock]')) errors.push(message.text());
        });
        await page.addInitScript(() => {
          const RealDate = Date;
          window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : ['2026-05-02T17:00:00Z'])); }
            static now() { return new RealDate('2026-05-02T17:00:00Z').getTime(); }
          };
        });
        const dir = path.join(out, `${size.width}x${size.height}`);
        fs.mkdirSync(dir, { recursive: true });
        try {
          await page.goto(`${url}/screenshot/${target.slug}`, { waitUntil: 'domcontentloaded' });
          await page.getByTestId(`screenshot-${target.slug}`).waitFor({ timeout: 180000 });
          await page.getByText(target.readyText, { exact: false }).first().waitFor({ timeout: 30000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(Number(process.env.SCREENSHOT_SETTLE_MS || 1500));
          if (errors.length) throw new Error(errors.join('\n'));
          const png = await page.screenshot({ path: path.join(dir, `${target.slug}.png`), animations: 'disabled' });
          if (png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height) {
            throw new Error(`Wrong PNG size: ${target.slug}`);
          }
          evidence.push({ slug: target.slug, ...size, readyText: target.readyText, url: page.url() });
          console.log(`Captured ${target.slug} ${size.width}x${size.height}`);
        } catch (error) {
          console.error(await page.locator('body').innerText());
          await page.screenshot({ path: path.join(dir, `${target.slug}-FAILED.png`) });
          throw error;
        } finally { await context.close(); }
      }
    }
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({
      profile: process.env.SCREENSHOT_PROFILE || 'production',
      coachTabsV2: env.EXPO_PUBLIC_FF_COACH_TABS_V2 || 'false',
      evidence, captions: SCREENSHOT_CAPTIONS,
    }, null, 2));
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    fs.closeSync(log);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
