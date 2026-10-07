import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { MoodEnergyPicker } from '../MoodEnergyPicker';
import { ENERGY_LABELS, MOOD_LABELS } from '../constants';
import { makeStyles } from '../styles';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));
jest.mock('../../../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));

it('keeps every check-in action with a single readable word per mood choice', async () => {
  const setMood = jest.fn(), setEnergy = jest.fn(), setSleepHours = jest.fn(), setNotes = jest.fn();
  function Picker() {
    const { colors, semanticColors } = useTheme();
    return <MoodEnergyPicker mood={3} setMood={setMood} energy={3} setEnergy={setEnergy}
      sleepHours={7} setSleepHours={setSleepHours} notes="" setNotes={setNotes}
      colors={colors} styles={makeStyles(colors, semanticColors)} />;
  }
  const view = await render(<Picker />);
  for (let value = 1; value <= 5; value += 1) {
    const label = view.getByText(MOOD_LABELS[value]);
    expect(label.props.style).toEqual(expect.arrayContaining([expect.objectContaining({
      fontSize: 13, textTransform: 'none', letterSpacing: 0,
    })]));
    await fireEvent.press(label);
    expect(setMood).toHaveBeenLastCalledWith(value);
    await fireEvent.press(view.getByText(ENERGY_LABELS[value]));
    expect(setEnergy).toHaveBeenLastCalledWith(value);
  }
  for (const retired of ['low', 'off', 'flat', 'good', 'strong']) expect(view.queryByText(retired)).toBeNull();
  await fireEvent.press(view.getByTestId('icon-remove'));
  expect(setSleepHours.mock.calls[0][0](7)).toBe(6.5);
  await fireEvent.press(view.getByTestId('icon-add'));
  expect(setSleepHours.mock.calls[1][0](7)).toBe(7.5);
  await fireEvent.changeText(view.getByPlaceholderText("How's your day going? Anything noteworthy?"), 'Steady');
  expect(setNotes).toHaveBeenCalledWith('Steady');
});
