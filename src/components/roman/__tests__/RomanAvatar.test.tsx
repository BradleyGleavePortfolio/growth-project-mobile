/**
 * RomanAvatar — §3.8 expression-register contract (P2-2).
 *
 * Pins:
 *   1. `expression="slight_smile"` announces the §3.8 milestone register
 *      ('Roman, slight smile') and shows the celebratory ring (the smile crop
 *      asset underneath).
 *   2. `expression="neutral"` announces the composed register ('Roman').
 *   3. `expression` takes precedence over `crop` when both are supplied.
 *
 * The bundled face asset resolves to a truthy image source, so the rendered
 * node carries the accessibility label we assert against.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import RomanAvatar from '../RomanAvatar';

describe('RomanAvatar — §3.8 expression register', () => {
  it('maps expression="slight_smile" to the §3.8 milestone label', () => {
    const { getByTestId } = render(
      <RomanAvatar expression="slight_smile" testID="avatar" />,
    );
    expect(getByTestId('avatar').props.accessibilityLabel).toBe(
      'Roman, slight smile',
    );
  });

  it('maps expression="neutral" to the composed label', () => {
    const { getByTestId } = render(
      <RomanAvatar expression="neutral" testID="avatar" />,
    );
    expect(getByTestId('avatar').props.accessibilityLabel).toBe('Roman');
  });

  it('lets expression win over crop when both are supplied', () => {
    const { getByTestId } = render(
      <RomanAvatar crop="neutral" expression="slight_smile" testID="avatar" />,
    );
    expect(getByTestId('avatar').props.accessibilityLabel).toBe(
      'Roman, slight smile',
    );
  });
});
