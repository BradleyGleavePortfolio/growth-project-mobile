/**
 * LS-913R3 B3: C7 Style B keeps cream on the unselected role tile.
 * O24 keeps the page ground #F7FAF7; it does not replace a tile's cream fill.
 * GOAL: planning/MOCKUP3/C7/style-b/B_role_ios390_100.png.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import RoleChoice from '../../../components/auth/RoleChoice';
import { colors } from '../../../theme/tokens';

it.each(['client', 'coach'] as const)(
  'LS-913R3 B3: selecting %s leaves the other C7 role tile cream',
  async (selected) => {
    const r = await render(
      <RoleChoice selected={selected} onSelect={jest.fn()} variant="tiles" />,
    );
    const other = selected === 'client' ? 'coach' : 'client';
    const chosen = StyleSheet.flatten(r.getByTestId(`role-choice-${selected}`).props.style);
    const unchosen = StyleSheet.flatten(r.getByTestId(`role-choice-${other}`).props.style);
    expect(chosen.backgroundColor).toBe(colors.forest);
    expect(unchosen.backgroundColor).toBe(colors.cream);
  },
);
