#!/usr/bin/env node
// Requires: npx playwright install chromium (not installed by default)
/**
 * Capture screenshots from the Expo web preview at iPhone 6.5" viewport.
 *
 * Prerequisites:
 *   - `npx expo start --web --port 8081` already running with
 *     EXPO_PUBLIC_SCREENSHOT_MODE=1 in its env
 *   - playwright + chromium installed: `npx playwright install chromium`
 *
 * Output:
 *   - 1284x2778 PNGs in ./screenshots/web-6.5/
 *
 * Caveats:
 *   - react-native-web renders some components differently from native
 *     (status bar, scroll indicators, system fonts). These captures are
 *     suitable for internal review and design sign-off; for App Store
 *     submission prefer the simulator path (capture-screenshots.sh).
 *   - The deep-link routes added in RootNavigator's linking config are used
 *     here as `#/<route>` URL fragments — react-navigation's web URL
 *     integration parses them.
 */

const { chromium, devices } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE_URL  = process.env.SCREENSHOT_WEB_URL || 'http://localhost:8081';
const OUT_DIR   = path.resolve(__dirname, '..', 'screenshots', 'web-6.5');
const SETTLE_MS = Number(process.env.SCREENSHOT_SETTLE_MS || 4000);
const VERBOSE   = process.env.SCREENSHOT_VERBOSE === '1';

// 6.5" target — 1284x2778. We render at the target's actual CSS size
// (428x926) with deviceScaleFactor 3 so the saved PNG is exactly 1284x2778.
const VIEWPORT = { width: 428, height: 926 };
const SCALE    = 3;

// Routes mirror src/screenshots/screens.ts. Keep in sync if that list changes.
const ROUTES = [
  { slug: '01-home',     path: '/home' },
  { slug: '02-log',      path: '/log' },
  { slug: '03-plan',     path: '/plan' },
  { slug: '04-recipes',  path: '/recipes' },
  { slug: '05-progress', path: '/progress' },
  { slug: '06-fasting',  path: '/fast' },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13 Pro Max']?.userAgent
      ?? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (VERBOSE || msg.type() === 'error' || msg.type() === 'warning') {
      process.stdout.write(`  [${msg.type()}] ${msg.text()}\n`);
    }
  });
  page.on('pageerror', (err) => {
    process.stdout.write(`  [pageerror] ${err.message}\n`);
  });

  // Disable CSS animations so captures are deterministic.
  await page.addInitScript(() => {
    const inject = () => {
      const root = document.documentElement || document.head || document.body;
      if (!root) return;
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `;
      root.appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject, { once: true });
    } else {
      inject();
    }
  });

  for (const r of ROUTES) {
    const url = `${BASE_URL}${r.path}`;
    process.stdout.write(`→ ${r.slug.padEnd(14)} ${url}\n`);
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    const out = path.join(OUT_DIR, `${r.slug}.png`);
    await page.screenshot({ path: out, fullPage: false });
    process.stdout.write(`  saved ${path.relative(process.cwd(), out)}\n`);
  }

  await browser.close();
  process.stdout.write(`\n✓ wrote ${ROUTES.length} screenshots to ${OUT_DIR}\n`);
})().catch((err) => {
  process.stderr.write(`error: ${err.stack || err.message}\n`);
  process.exit(1);
});