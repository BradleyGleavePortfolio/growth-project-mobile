/**
 * RomanAvatar (BLOCKER 3) + ConfirmModal variant (MAJOR UX-03) component tests.
 *
 * RomanAvatar:
 *   - With a `neutral`/`smile` crop and no override, the bundled brand face is
 *     resolved and an <Image> renders by DEFAULT — NOT the monogram tile. This
 *     is the launch contract: Roman's face appears on a Roman-voiced empty
 *     state without any network/CDN dependency.
 *   - A string `source` override (a future backend `avatar_url`) renders an
 *     <Image> with that uri.
 *   - The monogram tile is reachable ONLY when the crop is explicitly
 *     `monogram`, or when the resolved image fails to load (`onError`).
 *
 * ConfirmModal:
 *   - The `destructive` variant (the default) paints the confirm button with
 *     the `semantic.danger` tokens (bg/fg/border), so a delete never wears the
 *     brand/constructive accent.
 *   - The `constructive` variant keeps the brand accent fill.
 *   - The cohort-remove call-site passes `variant="destructive"` (asserted in
 *     the screen suite via the rendered danger token; here we assert the
 *     component honours the prop).
 *
 * useTheme is mocked to the real light tokens so semanticColors keys resolve.
 */
import React from 'react';
import { Image } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { semantic } from '../../../../theme/tokens';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import RomanAvatar from '../../RomanAvatar';
import ConfirmModal from '../ConfirmModal';

/** Flatten a possibly-array RN style into a single object. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
}

describe('RomanAvatar — bundled face is the default, monogram only on fallback', () => {
  it('renders an <Image> (NOT the monogram) for the neutral crop by default', () => {
    const { getByTestId } = render(
      <RomanAvatar crop="neutral" size={64} testID="roman" />,
    );
    const node = getByTestId('roman');
    expect(node.type).toBe('Image');
    // Accessible as Roman, neutral register.
    expect(node.props.accessibilityLabel).toBe('Roman');
    // No "R" monogram text child.
    expect(node.props.children).toBeUndefined();
  });

  it('renders an <Image> for the smile crop and announces the pleased register', () => {
    const { getByTestId } = render(
      <RomanAvatar crop="smile" size={64} testID="roman" />,
    );
    const node = getByTestId('roman');
    expect(node.type).toBe('Image');
    expect(node.props.accessibilityLabel).toBe('Roman, pleased');
  });

  it('renders an <Image> with the given uri when a string source override is provided', () => {
    const { getByTestId } = render(
      <RomanAvatar
        crop="neutral"
        source="https://cdn.example.com/roman/neutral.png"
        size={64}
        testID="roman"
      />,
    );
    const node = getByTestId('roman');
    expect(node.type).toBe('Image');
    expect(node.props.source).toEqual({
      uri: 'https://cdn.example.com/roman/neutral.png',
    });
  });

  it('renders the monogram tile (NOT an Image) when the crop is explicitly monogram', () => {
    const { getByTestId, getByText } = render(
      <RomanAvatar crop="monogram" size={28} testID="roman" />,
    );
    const node = getByTestId('roman');
    expect(node.type).not.toBe('Image');
    // The monogram tile contains the "R" text mark.
    expect(getByText('R')).toBeTruthy();
  });

  it('falls back to the monogram tile only after the image fails to load (onError)', () => {
    const { getByTestId, getByText } = render(
      <RomanAvatar crop="neutral" size={64} testID="roman" />,
    );
    const image = getByTestId('roman');
    expect(image.type).toBe('Image');
    // Simulate a load failure: the monogram tile takes over.
    fireEvent(image, 'error', { nativeEvent: { error: 'load failed' } });
    const after = getByTestId('roman');
    expect(after.type).not.toBe('Image');
    expect(getByText('R')).toBeTruthy();
  });
});

describe('ConfirmModal — destructive variant uses danger tokens (UX-03)', () => {
  const noop = () => {};

  it('the destructive variant (default) paints the confirm with semantic.danger tokens', () => {
    const { getByTestId, getByText } = render(
      <ConfirmModal
        visible
        title="Remove this client"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
        testID="cm"
      />,
    );
    const confirm = getByTestId('cm-confirm');
    const style = flatten(confirm.props.style);
    expect(style.backgroundColor).toBe(semantic.danger.bg);
    expect(style.borderColor).toBe(semantic.danger.border);
    // The label text uses the danger foreground.
    const labelStyle = flatten(getByText('Remove').props.style);
    expect(labelStyle.color).toBe(semantic.danger.fg);
  });

  it('an explicit destructive variant matches the default treatment', () => {
    const { getByTestId } = render(
      <ConfirmModal
        visible
        title="Hide this content"
        confirmLabel="Hide"
        variant="destructive"
        onConfirm={noop}
        onCancel={noop}
        testID="cm"
      />,
    );
    const style = flatten(getByTestId('cm-confirm').props.style);
    expect(style.backgroundColor).toBe(semantic.danger.bg);
    expect(style.borderColor).toBe(semantic.danger.border);
  });

  it('the constructive variant does NOT use the danger fill', () => {
    const { getByTestId } = render(
      <ConfirmModal
        visible
        title="Save changes"
        confirmLabel="Save"
        variant="constructive"
        onConfirm={noop}
        onCancel={noop}
        testID="cm"
      />,
    );
    const style = flatten(getByTestId('cm-confirm').props.style);
    expect(style.backgroundColor).not.toBe(semantic.danger.bg);
  });

  it('a busy destructive confirm is disabled and does not fire onConfirm', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <ConfirmModal
        visible
        title="Remove this client"
        confirmLabel="Remove"
        busy
        onConfirm={onConfirm}
        onCancel={noop}
        testID="cm"
      />,
    );
    fireEvent.press(getByTestId('cm-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
