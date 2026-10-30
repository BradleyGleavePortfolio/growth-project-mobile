/**
 * LS-E4R2 B1: the owner-picked C7 Style B consent frame has cream paragraph
 * cards and a full-forest selected agreement row, not the old plain P0.
 * GOAL: planning/MOCKUP3/C7/style-b/B_consent_{ios390,android360}_{100,130}.png.
 * The later one-box words change content, not these visual treatments.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import QuestionScreen from '../QuestionScreen';
import { screenById } from '../../../lib/consultation/definitions';
import { oneBoxConsentScreenCopy } from '../../../lib/consultation/copy';
import { colors, radius } from '../../../theme/tokens';

jest.mock('../../../config/featureFlags', () => ({
  ...jest.requireActual('../../../config/featureFlags'),
  featureFlags: {
    ...jest.requireActual('../../../config/featureFlags').featureFlags,
    firstRunV2: true,
    consultTilesV2: true,
  },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

describe.each([false, true])('LS-E4R2 B1: C7 Style B P0 (coach-free=%s)', (coachless) => {
  function draw() {
    return render(
      <QuestionScreen
        screen={screenById('P0')!}
        answers={{}}
        progress={null}
        ctx={{ first: 'Maya', coach: 'Sam', coachless }}
        now={new Date('2026-10-30T12:00:00Z')}
        onAnswer={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onFinishLater={null}
        consent={{ error: null }}
      />,
    );
  }

  it('wraps every disclosure paragraph in a cream radius-16 card', async () => {
    const r = await draw();
    for (const paragraph of oneBoxConsentScreenCopy(coachless).paragraphs) {
      const styles: Record<string, unknown>[] = [];
      for (let n = r.getByText(paragraph).parent; n; n = n.parent) {
        styles.push(StyleSheet.flatten(n.props.style) ?? {});
      }
      expect(styles).toEqual(expect.arrayContaining([
        expect.objectContaining({ backgroundColor: colors.cream, borderRadius: radius.card }),
      ]));
    }
  });

  it('fills the whole agreement row forest when selected', async () => {
    const r = await draw();
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    const row = r.getByTestId('consent-checkbox');
    expect(row.props.accessibilityState.checked).toBe(true);
    expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe(colors.forest);
  });
});
