// EW3-001 — App status-bar bone band smoke test.
//
// SDK 56 enables Android edge-to-edge: the bone (#F5EFE4) status-bar band is
// painted by a top-inset <StatusBarBand> View instead of the deprecated
// RNStatusBar.setBackgroundColor() call. This smoke test mounts that paint
// view with a mocked safe-area inset and asserts it renders at the inset
// height with the bone background (plus a snapshot).

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

import { StatusBarBand } from './src/components/StatusBarBand';

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === 'object') Object.assign(out, s as Record<string, unknown>);
  };
  walk(style);
  return out;
};

describe('StatusBarBand (EW3-001 edge-to-edge bone band)', () => {
  it('paints the bone band at the safe-area top inset height', () => {
    const { getByTestId, toJSON } = render(<StatusBarBand />);
    const band = getByTestId('status-bar-band');
    const flat = flatten(band.props.style);

    expect(flat.height).toBe(47);
    expect(flat.backgroundColor).toBe('#F5EFE4');
    expect(toJSON()).toMatchSnapshot();
  });
});
