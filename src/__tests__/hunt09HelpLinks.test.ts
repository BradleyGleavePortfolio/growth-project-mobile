/**
 * HUNT-09-124 (config vs code truth): every help link the app opens must be a
 * page the backend serves. Production answered a raw JSON 404 for
 * helpUrl('/coach') (coach Settings > Help centre) and "Page not available"
 * for the bare site root (client More > Membership > Open trygrowthproject.com).
 * The served list mirrors growth-project-backend src/main.ts (setGlobalPrefix
 * exclude: help, help/setup, help/first-client, help/tour, help/faq,
 * help/support, help/contact, help/delete-account).
 */
import * as fs from 'fs';
import * as path from 'path';
import { HELP_CONTACT_URL, HELP_PAGE_PATHS, env, helpUrl } from '../config/env';

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === '__tests__' || name === '__fixtures__' || name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// env.ts documents the old mistakes in comments; it is the definition site.
const files = sourceFiles(SRC).filter((f) => !f.endsWith(path.join('config', 'env.ts')));

describe('help links point at pages the backend serves', () => {
  it('every helpUrl() literal path is a served help page', () => {
    const served = new Set<string>(HELP_PAGE_PATHS);
    const bad: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const re = /helpUrl\(\s*(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)?\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = m[1] ?? m[2] ?? m[3] ?? '';
        const p = raw === '' ? '' : raw.startsWith('/') ? raw : `/${raw}`;
        if (!served.has(p)) bad.push(`${path.relative(SRC, file)}: helpUrl('${raw}')`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no screen opens the bare site root (it answers "Page not available")', () => {
    const bad = files.filter((file) =>
      /openURL\(\s*['"`]https:\/\/app\.trygrowthproject\.com\/?['"`]\s*\)/.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );
    expect(bad.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('the contact link is the served /help/contact page', () => {
    expect(HELP_CONTACT_URL).toBe(`${env.HELP_BASE_URL}/contact`);
    expect(helpUrl()).toBe(env.HELP_BASE_URL);
  });
});
