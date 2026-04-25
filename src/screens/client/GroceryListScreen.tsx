import React from 'react';
import ComingSoonBanner from '../../components/ComingSoonBanner';

/**
 * GroceryListScreen — temporarily a placeholder.
 *
 * The previous implementation read/wrote local SQLite (`db/shoppingListDb`)
 * with no backend; coaches couldn't see lists and a reinstall wiped them.
 * Per the structural audit (Fix #2) we ship surfaces without an end-to-end
 * backend as "Coming soon" until they're wired up.
 *
 * Prior implementation preserved in git history.
 */
export default function GroceryListScreen() {
  return (
    <ComingSoonBanner
      title="Grocery list"
      description="The coach-shared grocery list is being rebuilt so it follows you between phones and shows up on your coach's dashboard. We've paused the local-only version so you don't put work into a list that doesn't survive a reinstall."
    />
  );
}
