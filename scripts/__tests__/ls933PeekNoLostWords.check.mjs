/**
 * LS-933 B1: the app's own latest-check-in words must not be clipped.
 * Real ClientPeekSheet, real theme/fonts/HapticPressable, stub server replies.
 * Adapted from ctx#438's PEEK-K1-M2 web-preview harness.
 *
 * Run from the checkout:
 * /home/user/workspace/ops171/heavy.sh node scripts/__tests__/ls933PeekNoLostWords.check.mjs
 *
 * Web layout regression, not native-device or VoiceOver proof. Shared sandbox
 * dependencies are the same preinstalled dependencies used by ctx#438.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/user/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harness = path.join(root, 'scripts/__tests__/fixtures/ls933Peek');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ls933-peek-b1-'));
let browser;
try {
  execFileSync(process.execPath, [path.join(harness, 'build.mjs')], {
    env: { ...process.env, SRC: process.env.LS933_REVIEW_SRC ?? root, OUT: out },
    stdio: 'inherit',
  });
  browser = await chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files'],
    executablePath: '/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const failures = [];
  for (const platform of ['ios', 'android']) {
    for (const width of [320, 360, 390]) {
      for (const scale of [1, 1.3]) {
        const context = await browser.newContext({
          viewport: { width, height: platform === 'ios' && width === 320 ? 568 : 844 },
          deviceScaleFactor: 2,
          timezoneId: 'America/Los_Angeles',
        });
        try {
          const page = await context.newPage();
          await page.clock.setFixedTime(new Date('2026-11-04T18:00:00Z'));
          await page.goto(`file://${out}/index.html?w=${width}&h=844&t=24&b=0&fs=${scale}&st=nonote`);
          await page.waitForSelector('[data-testid="peek-value-checkins"]');
          await page.evaluate(() => document.fonts.ready);
          const measurement = await page.locator('[data-testid="peek-value-checkins"]').evaluate((element) => ({
            text: element.textContent,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          assert.equal(measurement.text, 'Yesterday: energy 4 of 5', 'fixture has no free-text note');
          const clipped = measurement.scrollHeight > measurement.clientHeight + 2 ||
            measurement.scrollWidth > measurement.clientWidth + 1;
          console.log(JSON.stringify({ platform, width, scale, clipped, ...measurement }));
          if (clipped) failures.push({ platform, width, scale, ...measurement });
        } finally {
          await context.close();
        }
      }
    }
  }
  assert.deepEqual(failures, [], 'app-authored check-in words stay fully visible at 320/360/390 pt and 100%/130%');
} finally {
  await browser?.close();
  fs.rmSync(out, { recursive: true, force: true });
}
