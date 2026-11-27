/**
 * CI-SUPERSEDED-M (agent alm, operator call under #ALM-E31): a new commit on a pull request cancels that pull
 * request's older runs of every workflow a pull request starts. Nothing else changes: pushes to main, the CodeQL
 * schedule and a CI dispatch each get a group of their own (github.run_id), so they are never queued behind each
 * other, replaced while pending or cancelled; the four required check names stay byte for byte.
 *
 * js-yaml is not declared in package.json: it is jest's own dependency (@jest/transform and babel-jest ->
 * babel-plugin-istanbul -> @istanbuljs/load-nyc-config -> js-yaml 3), so it is there wherever jest runs. If it
 * ever leaves the tree, this file fails when it loads ("Cannot find module 'js-yaml'"), never green by accident.
 * safeLoad keeps `on` a string key and throws on a duplicated key.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DIR = path.resolve(__dirname, '..', '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const load = (f) => yaml.safeLoad(read(f));
const FILES = fs
  .readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

function events(doc) {
  const on = doc.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on || {});
}
const PR_FILES = FILES.filter((f) => events(load(f)).includes('pull_request'));

// The one rule every pull request workflow follows: keyed on the PR number, falling back to the run id (unique
// per run) for every other event, and cancelling only on pull_request.
const PR_KEY = "${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}";
const CANCEL = "${{ github.event_name == 'pull_request' }}";
const PREFIX = {
  'ci.yml': 'ci-pr-',
  'codeql.yml': 'codeql-pr-',
  'route-contract.yml': 'route-pr-',
  'store-capture.yml': 'store-pr-',
};
const RULED = Object.keys(PREFIX).sort();

// The two workflows that already had a block keep it exactly. all-switches-on's ref-keyed group also serialises
// main pushes; changing it is a separate PR's job (it becomes a required check under 203-D43).
const KEPT = {
  'all-switches-on.yml': { group: 'all-switches-on-${{ github.ref }}', 'cancel-in-progress': CANCEL },
  'device-loop.yml': { group: 'device-loop', 'cancel-in-progress': false },
};

describe('a new commit on a pull request cancels that pull request older runs', () => {
  it('every workflow a pull request starts has the rule, or is all-switches-on (kept as it is)', () => {
    expect(PR_FILES).toEqual([...RULED, 'all-switches-on.yml'].sort());
  });

  it.each(RULED)('%s has one top-level concurrency block, before jobs:', (f) => {
    const doc = load(f);
    expect(doc.concurrency).toBeDefined();
    expect(Object.keys(doc.concurrency).sort()).toEqual(['cancel-in-progress', 'group']);
    const keys = Object.keys(doc);
    expect(keys.indexOf('concurrency')).toBeLessThan(keys.indexOf('jobs'));
    expect(read(f).match(/^concurrency:/gm)).toHaveLength(1);
  });

  it.each(RULED)('%s groups by the PR number with the github.run_id fallback, never by ref', (f) => {
    const { group } = load(f).concurrency || {};
    expect(group).toEqual(expect.any(String));
    expect(group).toContain('github.event.pull_request.number');
    expect(group).toContain('|| github.run_id }}');
    expect(group).not.toMatch(/github\.(ref|head_ref)\b/);
    expect(group).toBe(PREFIX[f] + PR_KEY);
  });

  it.each(RULED)('%s cancels only on pull_request', (f) => {
    expect((load(f).concurrency || {})['cancel-in-progress']).toBe(CANCEL);
  });

  it.each(RULED)('%s: no job has its own if: or concurrency, so the newest head runs every job', (f) => {
    for (const job of Object.values(load(f).jobs)) {
      expect(job.if).toBeUndefined();
      expect(job.concurrency).toBeUndefined();
    }
  });

  it.each(Object.keys(KEPT))('%s keeps its block exactly', (f) => {
    expect(load(f).concurrency).toEqual(KEPT[f]);
  });

  it('no two workflows share a group, so one workflow never cancels another', () => {
    // Every workflow file counts, whatever their number: the CI lane adds its own ci-lane.yml to the tree it tests.
    const groupOf = (f) => (load(f).concurrency || {}).group;
    for (const f of [...RULED, ...Object.keys(KEPT)]) expect(groupOf(f)).toEqual(expect.any(String));
    const groups = FILES.map(groupOf).filter(Boolean);
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe('pushes to main, the schedule and dispatch are unchanged', () => {
  it('ci.yml, codeql.yml and route-contract.yml still run on push to main', () => {
    for (const f of ['ci.yml', 'codeql.yml', 'route-contract.yml']) {
      expect(load(f).on.push).toEqual({ branches: ['main'] });
    }
  });

  it('the triggers of the four ruled workflows are exactly what they were', () => {
    expect(load('ci.yml').on).toEqual({ push: { branches: ['main'] }, pull_request: null, workflow_dispatch: null });
    expect(load('codeql.yml').on).toEqual({
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
      schedule: [{ cron: '19 11 * * 6' }],
    });
    expect(load('route-contract.yml').on).toEqual({ pull_request: null, push: { branches: ['main'] } });
    expect(load('store-capture.yml').on).toEqual({
      pull_request: {
        paths: ['src/screenshots/**', 'scripts/capture-screenshots*', 'App.tsx', '.github/workflows/store-capture.yml'],
      },
    });
  });
});

describe('the required check names stay byte for byte', () => {
  const jobNames = (f) => Object.fromEntries(Object.entries(load(f).jobs).map(([id, job]) => [id, job.name]));

  it('workflow names, job ids and job names of the four ruled workflows', () => {
    expect([load('ci.yml').name, jobNames('ci.yml')]).toEqual(['CI', { verify: 'Typecheck, lint, test' }]);
    expect([load('codeql.yml').name, jobNames('codeql.yml')]).toEqual([
      'CodeQL Advanced',
      { analyze: 'Analyze (${{ matrix.language }})' },
    ]);
    expect([load('route-contract.yml').name, jobNames('route-contract.yml')]).toEqual([
      'Route contract',
      { 'route-contract': 'Phone routes exist on backend main' },
    ]);
    expect([load('store-capture.yml').name, jobNames('store-capture.yml')]).toEqual([
      'Store capture',
      { capture: 'Real app store frames' },
    ]);
  });

  it('CodeQL still yields Analyze (actions) and Analyze (javascript-typescript)', () => {
    const analyze = load('codeql.yml').jobs.analyze;
    const checks = analyze.strategy.matrix.include.map((m) =>
      analyze.name.replace('${{ matrix.language }}', m.language),
    );
    expect(checks).toEqual(['Analyze (actions)', 'Analyze (javascript-typescript)']);
  });
});
