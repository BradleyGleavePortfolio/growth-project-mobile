/**
 * TrophyArtifact — Wave 1: Neutralized for luxury repositioning.
 *
 * Gradients, emoji icons, glow shadows, and "Tap to claim your trophy"
 * copy have been removed. This component renders a minimal placeholder
 * with milestone date and label as plain text.
 *
 * Full date-list redesign lands in Wave 3.
 */

import React, { forwardRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import tokens from '../../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MilestoneKind = 'streak' | 'badge' | 'identity';

export interface TrophyArtifactProps {
  kind: MilestoneKind;
  headline: string;
  subtitle: string;
  identityTitle: string;
  isFoundingMember?: boolean;
  previewScale?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TrophyArtifact = forwardRef<View, TrophyArtifactProps>(
  (
    {
      headline,
      subtitle,
      identityTitle,
      previewScale = 1,
    },
    ref,
  ) => {
    const size = 320 * previewScale;

    return (
      <View
        ref={ref}
        style={[styles.wrapper, { width: size, height: size }]}
        accessibilityLabel={`Milestone: ${headline} — ${subtitle}`}
      >
        <View style={styles.content}>
          {/* Milestone headline */}
          <Text style={[styles.headline, { fontSize: 32 * previewScale }]} numberOfLines={2}>
            {headline}
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { fontSize: 15 * previewScale }]}>
            {subtitle}
          </Text>

          {/* Thin divider */}
          <View style={styles.divider} />

          {/* Identity title */}
          <Text style={[styles.identityLabel, { fontSize: 11 * previewScale }]}>
            IDENTITY
          </Text>
          <Text style={[styles.identityValue, { fontSize: 16 * previewScale }]}>
            {identityTitle}
          </Text>

          {/* Footer */}
          <Text style={[styles.footer, { fontSize: 11 * previewScale }]}>
            @theGrowthProject
          </Text>
        </View>
      </View>
    );
  },
);

TrophyArtifact.displayName = 'TrophyArtifact';
export default TrophyArtifact;

// ─── HTML template for expo-print ─────────────────────────────────────────────

export function buildTrophyHtml(props: Omit<TrophyArtifactProps, 'previewScale'>): string {
  const { headline, subtitle, identityTitle } = props;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px;
      height: 1080px;
      overflow: hidden;
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      background: #1A1A18;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }
    .headline {
      font-size: 96px;
      font-weight: 400;
      color: #F5EFE4;
      text-align: center;
      letter-spacing: 2px;
      line-height: 1.1;
      padding: 0 64px;
      margin-bottom: 16px;
    }
    .subtitle {
      font-size: 32px;
      font-weight: 400;
      color: rgba(245,239,228,0.70);
      text-align: center;
      letter-spacing: 0.5px;
      margin-bottom: 32px;
    }
    .divider {
      width: 120px;
      height: 1px;
      background: #B1A89F;
      margin-bottom: 32px;
    }
    .identity-label {
      font-size: 11px;
      font-weight: 500;
      color: #B1A89F;
      letter-spacing: 8px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .identity-value {
      font-size: 28px;
      font-weight: 400;
      color: #F5EFE4;
      margin-bottom: 64px;
    }
    .footer {
      position: absolute;
      bottom: 56px;
      font-size: 20px;
      font-weight: 400;
      color: #B1A89F;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="headline">${headline}</div>
  <div class="subtitle">${subtitle}</div>
  <div class="divider"></div>
  <div class="identity-label">IDENTITY</div>
  <div class="identity-value">${identityTitle}</div>
  <div class="footer">@theGrowthProject</div>
</body>
</html>`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
    backgroundColor: '#1A1A18',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  headline: {
    fontWeight: '400',
    color: '#F5EFE4',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontWeight: '400',
    color: 'rgba(245,239,228,0.70)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 20,
  },
  divider: {
    width: 48,
    height: 1,
    backgroundColor: '#B1A89F',
    marginVertical: 12,
  },
  identityLabel: {
    fontWeight: '500',
    color: '#B1A89F',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  identityValue: {
    fontWeight: '400',
    color: '#F5EFE4',
    marginBottom: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: '#B1A89F',
  },
});
