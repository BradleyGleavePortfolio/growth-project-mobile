/**
 * src/ui/empty-states — Unified Empty State component library.
 *
 * Usage:
 *   import { EmptyState, EmptyStateNoClients, EmptyStateOffline } from '../ui/empty-states';
 *
 * All components consume theme tokens exclusively. No hardcoded hex values.
 * Variants are pre-composed for the most common app contexts; use the base
 * EmptyState for one-off or custom empty states.
 */

export { EmptyState, type EmptyStateProps } from './EmptyState';
export { EmptyStateNoClients } from './EmptyStateNoClients';
export { EmptyStateNoWorkouts } from './EmptyStateNoWorkouts';
export { EmptyStateNoData } from './EmptyStateNoData';
export { EmptyStateNoResults } from './EmptyStateNoResults';
export { EmptyStateOffline } from './EmptyStateOffline';

// Icon set — exported for external reuse in custom empty states.
export {
  IconPeople,
  IconClipboard,
  IconChartEmpty,
  IconSearchEmpty,
  IconOffline,
} from './icons';
