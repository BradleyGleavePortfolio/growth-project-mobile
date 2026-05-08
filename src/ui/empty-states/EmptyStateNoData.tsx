/**
 * EmptyStateNoData — Generic fallback for data-not-yet-loaded screens.
 *
 * Used when a screen has fetched successfully but the data set is empty
 * (e.g. no log entries yet, no chart data). Provides an optional retry CTA.
 *
 * @module src/ui/empty-states/EmptyStateNoData
 */

import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconChartEmpty } from './icons';

interface Props {
  /** Override the default headline. */
  headline?: string;
  /** Override the default body copy. */
  body?: string;
  /** Optional retry / action label. */
  ctaLabel?: string;
  /** Handler for the optional CTA. */
  onCta?: () => void;
}

/**
 * Generic "no data available" empty state. Suitable for chart screens,
 * log screens, and analytics panels with no entries.
 */
export function EmptyStateNoData({
  headline = 'Nothing here yet',
  body = 'Data will appear here once you start logging.',
  ctaLabel,
  onCta,
}: Props) {
  const { colors } = useTheme();

  return (
    <EmptyState
      icon={<IconChartEmpty size={64} color={colors.textMuted} />}
      headline={headline}
      body={body}
      ctaLabel={ctaLabel}
      onCta={onCta}
    />
  );
}

export default EmptyStateNoData;
