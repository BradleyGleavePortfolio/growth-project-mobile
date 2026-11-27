/**
 * LS-COR-1 stall probe (test-only scratch for a CI lane; never merge).
 * Turns every phone switch on for the jest workers the way the
 * "All switches on" job does through $GITHUB_ENV: it runs the job's own
 * discovery (.github/all-switches-on/switches.js find) and copies the names it
 * writes into this process's env before the workers start.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stall-probe-')), 'env');
  fs.writeFileSync(envFile, '');
  const env = { ...process.env, GITHUB_ENV: envFile };
  delete env.GITHUB_STEP_SUMMARY;
  execFileSync(process.execPath, ['.github/all-switches-on/switches.js', 'find'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  let n = 0;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) {
      process.env[m[1]] = m[2];
      n += 1;
    }
  }
  process.stderr.write(`STALLPROBE all-on: ${n} env names set\n`);
};
