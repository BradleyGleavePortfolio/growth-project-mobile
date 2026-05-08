/**
 * EmptyStateNoResults — Zero-results state for search / filter screens.
 *
 * Accepts the current search `query` prop and interpolates it into the body
 * copy. Includes a "Clear search" CTA that callers can wire to their
 * search-clear handler.
 *
 * @module src/ui/empty-states/EmptyStateNoResults
 */

import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconSearchEmpty } from './icons';

interface Props {
  /** The active search query string — shown in body copy. */
  query: string;
  /** Optional handler to clear the search field. */
  onClearSearch?: () => void;
}

/**
 * Search / filter — no results matched the query.
 */
export function EmptyStateNoResults({ query, onClearSearch }: Props) {
  const { colors } = useTheme();

  const body = query.trim().length > 0
    ? `No results for "${query}". Try a different search term.`
    : 'No results found. Try adjusting your filters.';

  return (
    <EmptyState
      icon={<IconSearchEmpty size={64} color={colors.textMuted} />}
      headline="No results"
      body={body}
      ctaLabel={onClearSearch ? 'Clear search' : undefined}
      onCta={onClearSearch}
    />
  );
}

export default EmptyStateNoResults;
