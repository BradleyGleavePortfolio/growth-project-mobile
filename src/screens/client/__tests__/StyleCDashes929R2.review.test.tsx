/**
 * LS-929R2 B1 review probe. This is a structural width-budget test, not a
 * browser/native layout claim. A nonwrapping, nonshrinking row with explicit
 * child widths cannot fit when those widths plus gaps exceed its content box.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { layout } from '../../../theme/tokens';
import { StyleCDashes } from '../../../ui/layout/StyleCPage';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('review B1: a normal twelve-item list stays inside the masthead', () => {
  it.each([320, 360, 390])('keeps every dash inside a %i-point screen', async (width) => {
    await render(<StyleCDashes total={12} done={4} label="8 to get." />);
    const dashGroup = screen.root!.children.find(
      (node) => typeof node !== 'string'
        && node.props.accessibilityElementsHidden === true
        && node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(dashGroup).toBeDefined();
    if (!dashGroup || typeof dashGroup === 'string') throw new Error('No dash group rendered');
    const row = StyleSheet.flatten(dashGroup!.props.style);
    const dashes = dashGroup!.children.filter((node) => typeof node !== 'string');
    const dashStyles = dashes.map((node: any) => StyleSheet.flatten(node.props.style));
    expect(dashStyles).toHaveLength(12);
    const availableWidth = width - layout.gutter * 2;
    const unwrappedWidth = dashStyles.reduce((sum, style) => sum + style.width, 0)
      + (row.columnGap ?? row.gap ?? 0) * (dashStyles.length - 1);
    const canReflow = row.flexWrap === 'wrap'
      || dashStyles.every((style) => style.flexShrink > 0);
    expect({ width, availableWidth, unwrappedWidth, fits: canReflow || unwrappedWidth <= availableWidth })
      .toEqual(expect.objectContaining({ fits: true }));
  });
});
