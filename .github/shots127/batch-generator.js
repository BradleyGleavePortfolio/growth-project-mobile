// Compose committed UI flows; never embed or print a secret value.
const fs = require('fs');
const path = require('path');
const root = path.join(process.cwd(), '.github/shots127');
const commands = [];
// Each screenshot is its own optional wrapper: a screen that no longer
// matches is skipped (and never captured) without stopping the others.
const tmp = path.dirname(path.resolve(process.argv[2]));
function shot(slug) {
  const wrapper = path.join(tmp, 'shot-' + slug + '.yaml');
  fs.writeFileSync(wrapper, 'appId: com.growthproject.app\n---\n' + JSON.stringify([
    { runFlow: path.join(root, 'flows', slug + '.yaml') },
    { runScript: { file: path.join(root, 'capture-native.js'), env: { SHOT: slug } } },
  ], null, 2));
  commands.push({ runFlow: { file: wrapper, optional: true } });
}
['01-welcome'].forEach(shot);
for (const role of ['CLIENT', 'COACH']) {
  let reason = '';
  if (process.env.INCLUDE_SIGNED_IN !== 'true') reason = 'signed-out milestone selected';
  else if (!process.env[`REVIEW_${role}_EMAIL`] || !process.env[`REVIEW_${role}_PASSWORD`]) reason = 'review secrets absent';
  if (reason) {
    fs.appendFileSync(path.join(process.env.SHOT_OUT, 'manifest.tsv'), `${role}\tSKIPPED (${reason})\n`);
    continue;
  }
  commands.push({ runFlow: {
    optional: true,
    file: path.join(root, 'flows/login.yaml'),
    env: {
      MAESTRO_REVIEW_EMAIL: '${MAESTRO_' + role + '_EMAIL}',
      MAESTRO_REVIEW_PASSWORD: '${MAESTRO_' + role + '_PASSWORD}',
    },
  } });
  const slugs = role === 'CLIENT'
    ? ['10-client-home', '11-client-train', '12-client-live-workout',
      '13-client-food-macros', '14-client-progress', '15-client-coach-messages',
      '16-client-roman', '17-client-calendar', '18-client-community']
    : ['20-coach-clients', '21-coach-client-detail', '22-coach-workout-builder',
      '23-coach-ask-ai', '24-coach-programs', '25-coach-money'];
  slugs.forEach(shot);
}
// JSON is a YAML subset. All nested flow paths are absolute.
fs.writeFileSync(process.argv[2], 'appId: com.growthproject.app\n---\n' + JSON.stringify(commands, null, 2));
