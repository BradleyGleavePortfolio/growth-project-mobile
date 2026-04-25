import React from 'react';
import ComingSoonBanner from '../../components/ComingSoonBanner';

/**
 * RecipesScreen — placeholder pending Wave 3 backend implementation.
 *
 * Decision (F11): keeping the tile in the HomeScreen quick-access grid and
 * the screen in the navigator avoids a layout shift in the 5-tile grid and
 * preserves deep-link compatibility. The banner now gives an honest "Wave 3"
 * estimate instead of open-ended "coming soon".
 *
 * Full prior local-SQLite implementation (~554 lines) is preserved in git
 * history. When a backend Recipes module ships, it will be restored on top of
 * React Query the same way Community and Habits were wired up in Wave 1.
 */
export default function RecipesScreen() {
  return (
    <ComingSoonBanner
      title="Recipes"
      description="A coach-synced recipe library is coming in Wave 3 (next update). We've taken down the local-only version to prevent data loss on phone resets. Your saved recipes are safe in the meantime."
    />
  );
}
