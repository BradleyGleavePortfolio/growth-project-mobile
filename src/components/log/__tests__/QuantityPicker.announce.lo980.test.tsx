// LO-980 B2 (lens, m#980 @ 3c0e2001): at main a failed save from the portion sheet is a native Alert, which VoiceOver
// focuses and reads. On the Style C day it becomes the inline card, whose only cue is accessibilityRole="alert"; on
// iOS React Native maps that role to UIAccessibilityTraitNone (RCTViewManager.m:31), so nothing is spoken when the
// card appears and the focused button's new label "Try again" is not read either. A VoiceOver user hears nothing
// after Log food fails. The card must be announced once when it appears (iOS), and live on Android.
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const chicken: SearchResult = {
  id: 'usda-1', name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6, nutrient_basis: 'PER_100G',
};
const LOG_FAILED = { title: "Couldn't log food", message: 'This food was not added. Check the connection and try again.' };
type Failure = React.ComponentProps<typeof QuantityPickerContent>['saveFailure'];
const Sheet = ({ failure }: { failure: Failure }) => (
  <QuantityPickerContent selectedFood={chicken} quantityInput="150" selectedUnit="g" mealLabel="Lunch"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onCancel={jest.fn()} onConfirm={jest.fn()}
    saveFailure={failure} confirmLabel={failure ? 'Try again' : undefined} />
);

describe('LO-980 B2: the save-failure card is spoken when it appears', () => {
  it('a failed save is announced once to a screen reader, as main\'s Alert was', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const view = await render(<Sheet failure={null} />);
    expect(announce).not.toHaveBeenCalled();
    await view.rerender(<Sheet failure={{ ...LOG_FAILED, retry: 'confirm' }} />);
    expect(screen.getByTestId('portion-save-failure')).toBeTruthy();
    const spoken = announce.mock.calls.map((c) => String(c[0]));
    const live = screen.getByTestId('portion-save-failure').props.accessibilityLiveRegion;
    expect({ spoken: spoken.filter((t) => t.includes(LOG_FAILED.title) && t.includes(LOG_FAILED.message)).length, live })
      .toEqual({ spoken: 1, live: expect.stringMatching(/^(polite|assertive)$/) });
  });
});
