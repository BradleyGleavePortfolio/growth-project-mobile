import React from 'react';
import { render, screen } from '@testing-library/react-native';
import InviteCoachCardDetails, { specialtiesSentence } from '../InviteCoachCardDetails';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));

describe('COACH-CARD-134 InviteCoachCardDetails', () => {
  it('renders the headline and the specialties sentence when present', async () => {
    await render(
      <InviteCoachCardDetails
        headline="Strength for busy parents"
        specialties={['strength', 'fat_loss', 'beginners']}
        testID="card"
      />,
    );
    expect(screen.getByTestId('card-headline')).toHaveTextContent('Strength for busy parents');
    expect(screen.getByTestId('card-specialties')).toHaveTextContent(
      'Specialises in strength, fat loss and beginners.',
    );
  });

  it('no blank rows: only the line that has content renders', async () => {
    await render(<InviteCoachCardDetails headline="  " specialties={['mobility']} testID="card" />);
    expect(screen.queryByTestId('card-headline')).toBeNull();
    expect(screen.getByTestId('card-specialties')).toHaveTextContent('Specialises in mobility.');
  });

  it('renders nothing for a coach who never did the consultation (null, [] or an older backend)', async () => {
    const { toJSON, rerender } = await render(<InviteCoachCardDetails headline={null} specialties={[]} testID="card" />);
    expect(toJSON()).toBeNull();
    await rerender(<InviteCoachCardDetails testID="card" />);
    expect(toJSON()).toBeNull();
  });

  it('drops unknown keys and "other"; two labels join with "and"', () => {
    expect(specialtiesSentence(['other', 'nope'])).toBeNull();
    expect(specialtiesSentence(['older', 'other', 'busy'])).toBe('Specialises in older adults and busy professionals.');
    expect(specialtiesSentence(undefined)).toBeNull();
  });
});
