import React from 'react';
import ComingSoonBanner from '../../components/ComingSoonBanner';

/**
 * ShoppingListScreen — temporarily a placeholder.
 *
 * The previous implementation read/wrote local SQLite (`db/shoppingListDb`)
 * with no backend; coaches couldn't see lists and a reinstall wiped them.
 * Per the structural audit (Fix #2) we ship surfaces without an end-to-end
 * backend as "Coming soon" until they're wired up.
 *
 * Prior implementation preserved in git history.
 */
export default function ShoppingListScreen() {
  return (
    <ComingSoonBanner
      title="Shopping list"
      description="A coach-visible shopping list that syncs across devices is on the roadmap. We've taken down the local-only version while we build the backend so nothing you save here disappears on a reinstall."
    />
  );
}
