import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const navigator = fs.readFileSync(path.join(ROOT, 'src/navigation/CoachNavigator.tsx'), 'utf8');
const predicate = navigator.match(/const showTeamTab = ([\s\S]*?);/)?.[1];
if (!predicate) throw new Error('CoachNavigator Team tab predicate missing');
// Evaluate the real navigator predicate, not a duplicated test-only condition.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const showTeamTab = new Function('featureFlags', 'teamStatus', `return ${predicate};`);

describe('Team Mode kill switch', () => {
  it('hides TeamStack for a head coach with a sub-coach when the flag is off', () => {
    expect(showTeamTab(
      { teamMode: false },
      { role: 'head_coach', hasSubCoaches: true },
    )).toBe(false);
    expect(navigator).toMatch(/\{showTeamTab && \(\s*<Tab.Screen\s+name="TeamStack"/);
    expect(navigator.match(/name="TeamStack"/g)).toHaveLength(1);
  });

  it('keeps the existing roster and role gates when explicitly enabled', () => {
    expect(showTeamTab({ teamMode: true }, { role: 'head_coach', hasSubCoaches: true })).toBe(true);
    expect(showTeamTab({ teamMode: true }, { role: 'head_coach', hasSubCoaches: false })).toBe(false);
    expect(showTeamTab({ teamMode: true }, { role: 'sub_coach', hasSubCoaches: true })).toBe(false);
    expect(showTeamTab({ teamMode: true }, { role: 'unknown', hasSubCoaches: true })).toBe(false);
  });

  it.each([undefined, 'false', 'true'])('resolves the committed flag for env %s', (value) => {
    const saved = process.env.EXPO_PUBLIC_FF_TEAM_MODE;
    if (value === undefined) delete process.env.EXPO_PUBLIC_FF_TEAM_MODE;
    else process.env.EXPO_PUBLIC_FF_TEAM_MODE = value;
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { featureFlags } = require('../../config/featureFlags');
        expect(featureFlags.teamMode).toBe(value === 'true');
      });
    } finally {
      if (saved === undefined) delete process.env.EXPO_PUBLIC_FF_TEAM_MODE;
      else process.env.EXPO_PUBLIC_FF_TEAM_MODE = saved;
    }
  });

  it('commits Team Mode off in every EAS build profile', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
    for (const profile of Object.values(eas.build) as { env?: Record<string, string> }[]) {
      expect(profile.env?.EXPO_PUBLIC_FF_TEAM_MODE).toBe('false');
    }
  });
});
