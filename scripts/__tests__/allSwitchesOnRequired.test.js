/**
 * ALL-ON-REQUIRED-M (agent alm, 203-D43 op 1, the owner's #203-E90 to #203-E92): "All switches on" becomes a
 * required check. Branch protection finds a required check by its job name, so this file pins:
 *   (a) the job's name, exactly "All switches on";
 *   (b) the triggers: push to main, every pull_request (no paths, paths-ignore or branches filter, which would
 *       leave the check pending on a PR it does not match), and workflow_dispatch (so a train branch can run it);
 *   (c) nothing that can skip the job on a pull request (GitHub reports a skipped job as passed);
 *   (d) the four required check names already on main, byte for byte.
 *
 * js-yaml is jest's own dependency, as prRunSupersede.test.js explains; if it leaves the tree this file fails when it
 * loads, never green by accident. safeLoad keeps `on` a string key and throws on a duplicated key.
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

const FILE = 'all-switches-on.yml';
const NAME = 'All switches on';
// The one step guard the workflow has: later steps still run when an earlier test step fails, and stop when the
// switch finder failed. It reads no event, ref or actor, so it cannot skip anything on a pull request.
const STEP_GUARD = "${{ !cancelled() && steps.find.outcome == 'success' }}";

// The check names a workflow's jobs report: the job's name (its id when it has none), with ${{ matrix.<key> }}
// filled in from each strategy.matrix.include row.
function checkNames(f) {
  const out = [];
  for (const [id, job] of Object.entries(load(f).jobs || {})) {
    const name = job.name || id;
    const rows = (job.strategy && job.strategy.matrix && job.strategy.matrix.include) || [];
    if (!rows.length) out.push(name);
    for (const row of rows) out.push(name.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, k) => row[k]));
  }
  return out;
}

describe('(a) the job is named exactly "All switches on"', () => {
  it('one job, all-switches-on, named "All switches on"', () => {
    const { jobs } = load(FILE);
    expect(Object.keys(jobs)).toEqual(['all-switches-on']);
    expect(jobs['all-switches-on'].name).toBe(NAME);
  });

  it('the workflow file no longer calls the check "not required"', () => {
    expect(read(FILE)).not.toMatch(/not\s+required/i);
  });

  it('no other job in any workflow reports a check named "All switches on"', () => {
    const owners = FILES.filter((f) => checkNames(f).includes(NAME));
    expect(owners).toEqual([FILE]);
    expect(checkNames(FILE)).toEqual([NAME]);
  });
});

describe('(b) it runs on push to main, on every pull request and on dispatch', () => {
  it('push: main only', () => {
    expect(load(FILE).on.push).toEqual({ branches: ['main'] });
  });

  it('pull_request: no paths, paths-ignore, branches, branches-ignore or types filter', () => {
    const { on } = load(FILE);
    expect(on).toHaveProperty('pull_request');
    expect(on.pull_request).toBeNull();
  });

  it('workflow_dispatch: present, with no inputs', () => {
    const { on } = load(FILE);
    expect(on).toHaveProperty('workflow_dispatch');
    expect(on.workflow_dispatch).toBeNull();
  });

  it('those three events and no other', () => {
    expect(Object.keys(load(FILE).on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  });
});

describe('(c) nothing can skip the job on a pull request', () => {
  const job = () => load(FILE).jobs['all-switches-on'];

  it('the job has no if:, needs: or continue-on-error:', () => {
    expect(job().if).toBeUndefined();
    expect(job().needs).toBeUndefined();
    expect(job()['continue-on-error']).toBeUndefined();
  });

  it('every step if: is the step guard, which reads no event, ref or actor', () => {
    const guards = job()
      .steps.map((s) => s.if)
      .filter((g) => g !== undefined);
    expect(guards.length).toBeGreaterThan(0);
    for (const g of guards) expect(g).toBe(STEP_GUARD);
  });
});

describe('(d) the four required check names on main stay byte for byte', () => {
  it.each([
    ['ci.yml', ['Typecheck, lint, test']],
    ['codeql.yml', ['Analyze (actions)', 'Analyze (javascript-typescript)']],
    ['route-contract.yml', ['Phone routes exist on backend main']],
  ])('%s reports %j', (f, names) => {
    expect(checkNames(f)).toEqual(names);
  });

  it('each required name, the new one included, comes from exactly one workflow', () => {
    const required = {
      'Typecheck, lint, test': 'ci.yml',
      'Analyze (javascript-typescript)': 'codeql.yml',
      'Analyze (actions)': 'codeql.yml',
      'Phone routes exist on backend main': 'route-contract.yml',
      [NAME]: FILE,
    };
    for (const [name, file] of Object.entries(required)) {
      expect([name, FILES.filter((f) => checkNames(f).includes(name))]).toEqual([name, [file]]);
    }
  });
});
