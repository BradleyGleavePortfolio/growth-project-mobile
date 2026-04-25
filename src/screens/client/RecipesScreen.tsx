import React from 'react';
import ComingSoonBanner from '../../components/ComingSoonBanner';

/**
 * RecipesScreen — temporarily a placeholder.
 *
 * The previous implementation read from local SQLite (`db/recipesDb`) only —
 * no backend, no coach visibility, no survival across reinstalls. Per the
 * structural audit (Fix #2), surfaces without an end-to-end backend ship as
 * "Coming soon" until they're wired up rather than pretending to work.
 *
 * Full prior implementation is preserved in git history (~554 lines). When a
 * backend Recipes module exists we'll restore it on top of React Query the
 * same way we did Community and Habits.
 */
export default function RecipesScreen() {
  return (
    <ComingSoonBanner
      title="Recipes"
      description="A real recipe library that syncs with your coach and survives a phone reset is on the way. We've taken down the local-only version while we build the backend so we don't lose any of your saved recipes the moment you reinstall."
    />
  );
}
