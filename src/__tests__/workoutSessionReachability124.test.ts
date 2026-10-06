import * as fs from 'fs';
import * as path from 'path';

describe('a client can correct an already logged workout (B-SESSION-1)', () => {
  it('offers an edit action in history and registers the protected editor route', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/client/WorkoutScreen.tsx'), 'utf8');
    const navigator = fs.readFileSync(path.join(__dirname, '../navigation/ClientNavigator.tsx'), 'utf8');
    expect(screen).toContain("navigation.navigate('WorkoutHistoryEdit', { workout: JSON.stringify(session) })");
    expect(screen).toContain('Edit workout ${session.workout_name');
    expect(navigator).toContain('withProtectedScreen(WorkoutHistoryEditScreen)');
    expect(navigator).toContain('name="WorkoutHistoryEdit" component={ProtectedWorkoutHistoryEditScreen}');
  });
});
