import * as fs from 'fs';
import * as path from 'path';

const settingsSource = fs.readFileSync(path.join(__dirname, '../SettingsScreen.tsx'), 'utf8');

describe('coach Settings truthfulness', () => {
  it('does not offer the Meal Templates route from Settings in v1', () => {
    expect(settingsSource).not.toContain('accessibilityLabel="Open meal templates"');
    expect(settingsSource).not.toContain("screen: 'CoachMealTemplates'");
    expect(settingsSource).toContain('Workout builder');
  });

  it('removes only the orphan meal-template route, retaining adjacent coach routes', () => {
    const navigator = fs.readFileSync(path.join(__dirname, '../../../navigation/CoachNavigator.tsx'), 'utf8');
    expect(navigator.includes('CoachMealTemplates')).toBe(false);
    for (const route of ['CoachMacrosReview', 'ClientConsultation', 'CoachWorkoutBuilder', 'CoachBulkInvite', 'InviteCodes']) {
      expect(navigator.includes(`name="${route}"`)).toBe(true);
    }
  });

  it('keeps the meal-template API and the client meal-plan hooks', () => {
    const hooks = fs.readFileSync(path.join(__dirname, '../../../hooks/useMealTemplates.ts'), 'utf8');
    const api = fs.readFileSync(path.join(__dirname, '../../../api/mealTemplatesApi.ts'), 'utf8');
    expect(api).toContain('export const mealTemplatesApi');
    expect(hooks).toContain('export function useMealTemplates()');
    expect(hooks).toContain('export function useMealPlanToday(');
  });

  it('caches and confirms a bio only after the API accepts it', () => {
    const saveBody = settingsSource.match(/const handleSaveBio = async \(\) => \{([\s\S]*?)\n {2}\};/)?.[1];
    expect(saveBody).toBeDefined();
    if (!saveBody) return;

    const apiUpdate = saveBody.indexOf('await profileApi.update({ bio: bioText })');
    const cacheUpdate = saveBody.indexOf("await AsyncStorage.setItem('gp_coach_bio_' + userId, bioText)");
    const successTap = saveBody.indexOf('successTap()');
    const closeEditor = saveBody.indexOf('setShowBioModal(false)');
    const failureStart = saveBody.indexOf('} catch (err) {');
    const failureEnd = saveBody.indexOf('\n    }\n\n    // Keep the local cache', failureStart);
    const failureBranch = saveBody.slice(failureStart, failureEnd);

    expect(apiUpdate).toBeGreaterThanOrEqual(0);
    expect(cacheUpdate).toBeGreaterThan(apiUpdate);
    expect(successTap).toBeGreaterThan(cacheUpdate);
    expect(closeEditor).toBeGreaterThan(successTap);
    expect(failureBranch).toContain('The bio was not saved. Check the connection and try again.');
    expect(failureBranch).toContain('return;');
    expect(failureBranch).not.toContain('setShowBioModal(false)');
  });
});
