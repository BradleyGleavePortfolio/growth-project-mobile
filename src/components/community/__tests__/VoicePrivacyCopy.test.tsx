/**
 * VoicePrivacyCopy — AUDIT pin: the audience disclosure must be a REAL,
 * specific description of who can hear the recording, never a vague
 * placeholder. Tests cover the pure `describeVoiceAudience` builder for all
 * three targets (DM / cohort / hall) — both with and without known names — and
 * that the rendered component surfaces the concrete sentence to AT.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoicePrivacyCopy, { describeVoiceAudience } from '../VoicePrivacyCopy';

describe('describeVoiceAudience — concrete, never-vague audience', () => {
  it('names the DM recipient when known', async () => {
    expect(
      describeVoiceAudience({ kind: 'dm', recipientName: 'Sara Okafor' }),
    ).toBe('Only Sara Okafor can hear this voice note.');
  });

  it('still scopes a DM to the recipient (never "everyone") when the name is unknown', () => {
    const s = describeVoiceAudience({ kind: 'dm', recipientName: null });
    expect(s).toContain('Only');
    expect(s).not.toMatch(/everyone/i);
  });

  it('names the cohort when known', async () => {
    expect(
      describeVoiceAudience({ kind: 'cohort', cohortName: 'Spring Block' }),
    ).toBe('Everyone in Spring Block can hear this voice note.');
  });

  it('names the community for a hall note', async () => {
    expect(
      describeVoiceAudience({ kind: 'hall', communityName: 'TGP Inner Circle' }),
    ).toBe('Everyone in TGP Inner Circle can hear this voice note.');
  });

  it('never returns a bare placeholder like "the community" with no scoping verb', () => {
    for (const s of [
      describeVoiceAudience({ kind: 'hall', communityName: null }),
      describeVoiceAudience({ kind: 'cohort', cohortName: '' }),
    ]) {
      // Even the fallback is a real audience sentence, not "shared" boilerplate.
      expect(s).toMatch(/can hear this voice note\.$/);
      expect(s).toMatch(/^(Only|Everyone)/);
    }
  });
});

describe('VoicePrivacyCopy — render', () => {
  it('exposes the concrete audience sentence as the accessible label', async () => {
    const { getByTestId } = await render(
      <VoicePrivacyCopy target={{ kind: 'cohort', cohortName: 'Spring Block' }} />,
    );
    const node = getByTestId('voice-privacy-copy');
    expect(node.props.accessibilityLabel).toBe(
      'Everyone in Spring Block can hear this voice note.',
    );
    expect(getByTestId('voice-privacy-text').props.children).toBe(
      'Everyone in Spring Block can hear this voice note.',
    );
  });
});
