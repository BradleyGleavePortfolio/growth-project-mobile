/**
 * EmptyStateNoClients — Empty state for the coach's client roster screen.
 *
 * Shown in CoachHomeScreen / ClientsListScreen when the coach has no active
 * clients. The CTA triggers the invite flow.
 *
 * @module src/ui/empty-states/EmptyStateNoClients
 */

import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconPeople } from './icons';

interface Props {
  /** Handler called when "Invite your first client" is pressed. */
  onInvite?: () => void;
}

/**
 * Coach home — no clients onboarded yet.
 * Prompts the coach to send an invite code.
 */
export function EmptyStateNoClients({ onInvite }: Props) {
  const { colors } = useTheme();

  return (
    <EmptyState
      icon={<IconPeople size={64} color={colors.textMuted} />}
      headline="No clients yet"
      body="Your client roster is empty. Send an invite code to get started."
      ctaLabel="Invite your first client"
      onCta={onInvite}
    />
  );
}

export default EmptyStateNoClients;
