/**
 * Links shown at the foot of the Trust & Privacy screen.
 *
 * The Privacy Policy and the Consumer Health Data Privacy Policy are public
 * pages at the site root (see PRIVACY_POLICY_URL in config/env.ts). The
 * consumer health policy must be reachable from the app's settings (RCW
 * 19.373.010 counts in-app settings links as part of an app's homepage), so it
 * sits here next to the Privacy Policy.
 *
 * When a link does not open, trustCenterLinkFailure.ts names the page
 * (`pageName`) and says why and what to do next (OR-112-15).
 */
import { CONSUMER_HEALTH_POLICY_URL, PRIVACY_POLICY_URL, helpUrl } from '../config/env';

export type TrustCenterLinkId = 'privacy_policy' | 'consumer_health_policy' | 'help_centre';

export interface TrustCenterLink {
  /** Stable id for diagnostics (Sentry), never shown. */
  id: TrustCenterLinkId;
  label: string;
  url: string;
  accessibilityLabel: string;
  testID: string;
  /** The page as named in failure copy, after "the" ("the Privacy Policy did not open"). */
  pageName: string;
}

export function trustCenterLinks(): TrustCenterLink[] {
  return [
    {
      id: 'privacy_policy',
      label: 'Privacy Policy',
      url: PRIVACY_POLICY_URL,
      accessibilityLabel: 'Open the Privacy Policy',
      testID: 'trust-link-privacy',
      pageName: 'Privacy Policy',
    },
    {
      id: 'consumer_health_policy',
      label: 'Consumer Health Data Privacy Policy',
      url: CONSUMER_HEALTH_POLICY_URL,
      accessibilityLabel: 'Open the Consumer Health Data Privacy Policy',
      testID: 'trust-link-consumer-health',
      pageName: 'Consumer Health Data Privacy Policy',
    },
    {
      id: 'help_centre',
      label: 'Visit the help centre',
      url: helpUrl(),
      accessibilityLabel: 'Open the help centre',
      testID: 'trust-link-help',
      pageName: 'help centre',
    },
  ];
}
