// REDO-FOOD-133 (APPLY-FOOD-133, part 1 of 2): Food log page on the shared primitives and rounded tokens.
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import DailySummaryBar from '../DailySummaryBar';
import DaySelector from '../../DaySelector';
import WaterTracker from '../../WaterTracker';
import MealSectionCard from '../MealSectionCard';
import { lightTokens, radius } from '../../../theme/tokens';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useSettings', () => ({ ...jest.requireActual('../../../hooks/useSettings'), useSettings: () => ({ settings: { waterGoalOz: 64 } }) }));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-08' }));

type Flat = TextStyle & ViewStyle;
const flat = (node: { props: { style?: unknown } }): Flat => StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {};
const noClip = (node: { props: { style?: unknown } }) => expect(flat(node).lineHeight).toBeGreaterThanOrEqual(1.2 * (flat(node).fontSize as number));

const SRC = path.join(__dirname, '..', '..', '..');
const FILES = ['screens/client/LogScreen.tsx', 'components/log/MealSectionCard.tsx', 'components/log/DailySummaryBar.tsx', 'components/WaterTracker.tsx', 'components/DaySelector.tsx'];

describe('Food log page redesign (REDO-FOOD-133)', () => {
  it('keeps the five Food log page files on the shared parts and tokens', () => {
    for (const file of FILES) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      for (const banned of [/TouchableOpacity/, /\bColors\b/, /borderRadius:\s*\d/, /SafeAreaView/]) expect([file, banned.test(source)]).toEqual([file, false]);
    }
    const log = fs.readFileSync(path.join(SRC, 'screens/client/LogScreen.tsx'), 'utf8');
    expect(log).toMatch(/<Screen\s+edges=\{\['top'\]\}/);
    expect(log).not.toMatch(/paddingTop:\s*60/);
  });

  it('shows the day as a serif headline that never clips, with the same three controls', async () => {
    await render(<DaySelector selectedDate="2026-10-08" onDateChange={jest.fn()} />);
    const today = screen.getByText('Today');
    expect(flat(today).fontFamily).toBe('CormorantGaramond_400Regular');
    noClip(today);
    expect(screen.getByLabelText('Previous day')).toBeTruthy();
    expect(screen.getByLabelText('Viewing today')).toBeTruthy();
    expect(screen.getByLabelText('Next day')).toBeTruthy();
  });

  it('sets the hero number in serif display with lining, tabular figures and room for descenders', async () => {
    await render(<DailySummaryBar dailyTotals={{ calories: 986, protein: 76, carbs: 114, fat: 24 }} remaining={1164}
      targets={{ calories: 2150, protein: 180, carbs: 210, fat: 70 }} />);
    const hero = screen.getByText('1164');
    expect(flat(hero)).toMatchObject({ fontFamily: 'CormorantGaramond_400Regular', fontSize: 44, fontVariant: ['lining-nums', 'tabular-nums'] });
    noClip(hero);
    expect(flat(screen.getByText('Calories left'))).toMatchObject({ textTransform: 'uppercase', fontSize: 11 });
  });

  it('titles meals and water in serif with tabular totals and no filled controls', async () => {
    await render(<MealSectionCard label="Lunch" mealType="lunch" logs={[]} mealCalories={540} onAddPress={jest.fn()} onDeletePress={jest.fn()} />);
    noClip(screen.getByText('Lunch'));
    expect(flat(screen.getByText('540 kcal')).fontVariant).toEqual(['tabular-nums']);
    await render(<WaterTracker currentOz={40} onAdd={jest.fn()} />);
    noClip(screen.getByText('Water'));
    const add = flat(screen.getByLabelText('Add 8 ounces of water'));
    expect(add).toMatchObject({ borderRadius: radius.chip, borderWidth: StyleSheet.hairlineWidth });
    expect(add.backgroundColor).not.toBe(lightTokens.accent);
  });
});
