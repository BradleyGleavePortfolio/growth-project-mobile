/**
 * Opens a public legal page (Terms of Service, Privacy Policy). When the phone
 * cannot open the link, the alert names the page and gives its exact web
 * address, so the person can still read it in any browser.
 */
import { Alert, Linking } from 'react-native';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../config/env';
import { logger } from '../utils/logger';

export const legalPageFailureBody = (title: string, url: string): string =>
  `This phone could not open the link. Open ${url.replace(/^https:\/\//, '')} in any web browser to read the ${title}.`;

export function openLegalPage(url: string, title: string): void {
  Linking.openURL(url).catch((err: unknown) => {
    logger.warn('legalLinks', `${title} link did not open`, err);
    Alert.alert(title, legalPageFailureBody(title, url));
  });
}

export const openTermsOfService = (): void => openLegalPage(TERMS_URL, 'Terms of Service');
export const openPrivacyPolicyPage = (): void => openLegalPage(PRIVACY_POLICY_URL, 'Privacy Policy');
