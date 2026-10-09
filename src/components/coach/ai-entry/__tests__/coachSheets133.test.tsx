/**
 * REDO-COACH-133 (b), QA-SHEETS-128 coach part read with the owner's 17:07
 * ruling (Q10b, "nice rounded corners, luxurious, not rectangles"): the five
 * coach AI surfaces take every corner from the radius tokens, sheets get the
 * 24 pt top corners, a grab handle, a serif title and a bottom that clears the
 * gesture bar; no cream card fills; the client-copy action is outlined so the
 * builder keeps one filled forest button.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { lightTokens, radius } from '../../../../theme/tokens';

jest.mock('../../../../api/workoutRevisionsApi', () => ({
  listWorkoutRevisions: jest.fn(async () => []),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

import RevisionHistorySheet from '../RevisionHistorySheet';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const SHEETS = ['ai-builder/AiBuilderSheet.tsx', 'ai-entry/WeekAiSheet.tsx', 'ai-entry/AdjustForClient.tsx', 'ai-entry/RevisionHistorySheet.tsx'];
const ALL = [...SHEETS, 'ai-entry/ClientCopyBar.tsx'];

describe.each(ALL)('%s', (file) => {
  const code = read(file);
  it('takes every corner from the radius tokens and has no cream card fill', () => {
    expect(code).not.toMatch(/borderRadius:\s*\d/);
    expect(code).not.toMatch(/borderTop(Left|Right)Radius:\s*\d/);
    expect(code).not.toMatch(/backgroundColor:\s*sc\.bgSurface/);
  });
});

describe.each(SHEETS)('%s sheet', (file) => {
  const code = read(file);
  it('has 24 pt top corners, a hairline edge, a grab handle, a serif title and a bottom clear of the gesture bar', () => {
    expect(code).toMatch(/borderTopLeftRadius: radius\.sheet, borderTopRightRadius: radius\.sheet, borderWidth: StyleSheet\.hairlineWidth/);
    expect(code).toMatch(/style=\{\[styles\.handle, \{ backgroundColor: sc\.border \}\]\}/);
    expect(code).toMatch(/accessibilityRole="header" style=\{\[typography\.h2/);
    expect(code).toMatch(/paddingBottom: footerBottomPadding\(insets\.bottom\)/);
  });
});

it('the client-copy action is outlined, so the builder keeps one filled forest button', () => {
  const code = read('ai-entry/ClientCopyBar.tsx');
  expect(code).not.toMatch(/backgroundColor:\s*busy \|\| done \? sc\.disabledBg : sc\.accent/);
  expect(code).toMatch(/borderColor: busy \|\| done \? sc\.border : sc\.accentText/);
});

describe('RevisionHistorySheet render', () => {
  it.each([
    ['360x800 Android, no gesture inset', { top: 24, bottom: 0, left: 0, right: 0 }, 24],
    ['390x844 iPhone, home indicator', { top: 47, bottom: 34, left: 0, right: 0 }, 42],
  ] as const)('%s: the sheet bottom clears the device edge', async (_label, insets: EdgeInsets, bottom) => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <RevisionHistorySheet planId="p1" onClose={jest.fn()} sc={lightTokens} />
      </SafeAreaInsetsContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText('History')).toBeTruthy());
    const sheet = StyleSheet.flatten(screen.getByTestId('revision-history-sheet').props.style);
    expect(sheet.paddingBottom).toBe(bottom);
    expect(sheet.borderTopLeftRadius).toBe(radius.sheet);
    expect(sheet.borderTopRightRadius).toBe(24);
  });
});
