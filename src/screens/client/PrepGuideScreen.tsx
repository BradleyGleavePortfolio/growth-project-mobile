import React from 'react';
import ComingSoonBanner from '../../components/ComingSoonBanner';

/**
 * PrepGuideScreen — temporarily a placeholder.
 *
 * The previous implementation read meal plans + recipes from local SQLite
 * only (`db/mealPlanDb`, `db/recipesDb`). With no backend, prep guides were
 * per-device and the coach couldn't tell whether a client had actually
 * prepped. Per the structural audit (Fix #2), we ship surfaces without an
 * end-to-end backend as "Coming soon" until they're wired up.
 *
 * Prior implementation preserved in git history.
 */
export default function PrepGuideScreen() {
  return (
    <ComingSoonBanner
      title="Prep guide"
      description="The weekly prep guide is being rebuilt on top of the coach-assigned meal-plan service so what you prep is visible to your coach in their next briefing. The local-only version is paused while we wire it up."
    />
  );
}
