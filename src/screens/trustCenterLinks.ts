/**
 * Links shown at the foot of the Trust & Privacy screen.
 *
 * The Privacy Policy and the Consumer Health Data Privacy Policy are public
 * pages at the site root (see PRIVACY_POLICY_URL in config/env.ts). The
 * consumer health policy must be reachable from the app's settings (RCW
 * 19.373.010 counts in-app settings links as part of an app's homepage), so it
 * sits here next to the Privacy Policy.
 */
import { CONSUMER_HEALTH_POLICY_URL, PRIVACY_POLICY_URL, helpUrl } from '../config/env';

export interface TrustCenterLink {
  label: string;
  url: string;
  accessibilityLabel: string;
  testID: string;
  /** Alert title when the URL cannot be opened. */
  failureTitle: string;
}

export function trustCenterLinks(): TrustCenterLink[] {
  return [
    {
      label: 'Privacy Policy',
      url: PRIVACY_POLICY_URL,
      accessibilityLabel: 'Open the Privacy Policy',
      testID: 'trust-link-privacy',
      failureTitle: 'Privacy Policy unavailable',
    },
    {
      label: 'Consumer Health Data Privacy Policy',
      url: CONSUMER_HEALTH_POLICY_URL,
      accessibilityLabel: 'Open the Consumer Health Data Privacy Policy',
      testID: 'trust-link-consumer-health',
      failureTitle: 'Policy unavailable',
    },
    {
      label: 'Visit the help centre',
      url: helpUrl(),
      accessibilityLabel: 'Open the help centre',
      testID: 'trust-link-help',
      failureTitle: 'Help unavailable',
    },
  ];
}
