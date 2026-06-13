// RiskDot — snapshot guard for the three traffic-light buckets.

import React from 'react';
import { render } from '@testing-library/react-native';
import RiskDot from '../components/RiskDot';

// ThemeProvider depends on useFoundingNumber → react-query → AsyncStorage.
// For a snapshot test we just need a deterministic colour map, so we mock
// the theme module to a minimal stub.
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      success: '#2C4A36',
      warning: '#C5A253',
      error: '#4A0404',
    },
  }),
}));

describe('RiskDot', () => {
  it('renders the green bucket', async () => {
    const { toJSON } = await render(<RiskDot bucket="green" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders the amber bucket', async () => {
    const { toJSON } = await render(<RiskDot bucket="amber" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders the red bucket', async () => {
    const { toJSON } = await render(<RiskDot bucket="red" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('honours a custom size', async () => {
    const { toJSON } = await render(<RiskDot bucket="red" size={24} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
