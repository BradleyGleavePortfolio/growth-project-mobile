import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('FU-COPY-126 dead rows and action-specific alerts', () => {
  it('keeps one working bulk-invite entry in coach Settings', () => {
    const src = read('screens/coach/SettingsScreen.tsx');
    expect(src).toContain('settings-bulk-invite');
    expect(src).toContain("screen: 'BulkInvite'");
    expect(src).not.toContain('Invite Codes (bulk)');
    expect(src).not.toContain("screen: 'CoachBulkInvite'");
  });

  it('does not offer display preferences that the app does not use', () => {
    const src = read('screens/client/SettingsScreen.tsx');
    expect(src).not.toContain('>Units<');
    expect(src).not.toContain('Calorie Display');
    expect(src).toContain('Meals Per Day');
    expect(src).toContain('Water Goal (fl oz)');
  });

  it.each(['GroceryListScreen', 'ShoppingListScreen', 'PrepGuideScreen', 'RecipeDetailScreen'])(
    '%s names the failed action instead of using an Error title',
    (name) => {
      const src = read(`screens/client/${name}.tsx`);
      expect(src).not.toContain("Alert.alert('Error'");
      expect(src).not.toContain('Please try again.');
    },
  );

  it('legacy invite failures never display technical exception text', () => {
    const src = read('screens/coach/CoachBulkInviteScreen.tsx');
    expect(src).not.toContain('Unknown error');
    expect(src).not.toContain('err.message');
    expect(src).toContain('Your pasted list is still here.');
    expect(src).toContain('Your email list is still here.');
  });
});
