/* Review-only render test support. No production modules are replaced here.
 * The input is an Expo web export of the FIX-974R1 harness using the reviewed
 * source head. See LS-974R2.md beside this file for the exact harness revision.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

async function withSummary(fixture, check) {
  const [distArg, outArg] = process.argv.slice(2);
  assert.ok(distArg, 'Pass the exact-head harness export directory');
  const dist = path.resolve(distArg);
  const out = path.resolve(outArg || '/tmp/ls974r2-render');
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'No web export found');
  fs.mkdirSync(out, { recursive: true });
  const types = { '.html': 'text/html', '.js': 'application/javascript',
    '.json': 'application/json', '.ttf': 'font/ttf', '.css': 'text/css', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const real = Date.now.bind(Date), start = real();
      Date.now = () => 1794607200000 + (real() - start);
    });
    await page.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')
        ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/?fix=${fixture}&os=ios`);
    await page.waitForFunction(() => window.__SHOT_READY === true);
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId('finish-workout').first().click();
    await page.getByTestId('summary-ring').first().waitFor();
    await page.getByText('Send to Sam', { exact: true }).first().waitFor();
    await frames(page);
    assert.deepEqual(errors, [], 'The preview must load without runtime errors');
    await check(page, out);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

const frames = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function geometry(page, ids) {
  return page.evaluate(names => Object.fromEntries(names.map(id => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return [id, null];
    const r = el.getBoundingClientRect();
    return [id, { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }];
  })), ids);
}

async function save(page, out, name, measured) {
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
  fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(measured, null, 2)}\n`);
  console.log(JSON.stringify({ test: name, measured }));
}

module.exports = { assert, withSummary, frames, geometry, save };
