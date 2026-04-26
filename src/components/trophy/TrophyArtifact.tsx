/**
 * TrophyArtifact — Psych Report #5 "Trophy-Grade Milestone Artifact"
 *
 * Renders a beautiful 1080×1080 (Instagram square) shareable card for milestone moments:
 *   - Badge earned
 *   - Streak milestones (7 / 30 / 90 days)
 *   - Identity title upgrades
 *
 * Rendering strategy (no new native deps):
 *   Uses expo-print to render an HTML template → PDF/PNG that can be saved
 *   or shared. expo-sharing (already in Expo SDK 55) handles the share sheet.
 *   Falls back gracefully if expo-print is unavailable.
 *
 * Design:
 *   - Gold gradient background for founding members, brand green for free tier
 *   - Large milestone headline (streak number, badge name, identity title)
 *   - Identity title sub-line
 *   - "@theGrowthProject" footer
 *   - Founding-member ribbon if applicable
 */

import React, { forwardRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import tokens, { gold } from '../../theme/tokens';
import { Colors } from '../../constants/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MilestoneKind = 'streak' | 'badge' | 'identity';

export interface TrophyArtifactProps {
  /** Kind of milestone being celebrated */
  kind: MilestoneKind;
  /** Main headline value — streak count ("7"), badge name ("Iron Veteran"), title */
  headline: string;
  /** Subtitle label shown beneath the headline */
  subtitle: string;
  /** User's current identity title label */
  identityTitle: string;
  /** Whether the user is a founding member (drives gold vs brand gradient) */
  isFoundingMember?: boolean;
  /** Rendered at reduced size for preview card (default renders at CARD_SIZE) */
  previewScale?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD_SIZE = 320; // scaled preview; HTML template targets 1080×1080

// ─── Gradient configs ─────────────────────────────────────────────────────────

const FOUNDER_GRADIENT: [string, string, ...string[]] = [
  '#3D2800',   // deep gold-brown
  '#7A5214',   // gold[800]
  '#C4922A',   // gold[500]
  '#E9C46A',   // gold[400] warm highlight
];

const FREE_GRADIENT: [string, string, ...string[]] = [
  '#1B4332',   // brand primaryDark
  '#2D6A4F',   // brand primary
  '#40916C',   // brand accent
  '#52B788',   // brand primaryLight
];

// ─── Milestone icon (purely text/emoji — no new deps) ─────────────────────────

function milestoneIcon(kind: MilestoneKind, isFounder: boolean): string {
  if (kind === 'streak') return '🔥';
  if (kind === 'badge') return isFounder ? '👑' : '🏅';
  return '⚡';
}

// ─── Component ────────────────────────────────────────────────────────────────

const TrophyArtifact = forwardRef<View, TrophyArtifactProps>(
  (
    {
      kind,
      headline,
      subtitle,
      identityTitle,
      isFoundingMember = false,
      previewScale = 1,
    },
    ref,
  ) => {
    const gradient = isFoundingMember ? FOUNDER_GRADIENT : FREE_GRADIENT;
    const accentColor = isFoundingMember ? gold[400] : Colors.primaryLight;
    const accentFg = isFoundingMember ? gold[800] : Colors.primaryDark;
    const size = CARD_SIZE * previewScale;
    const icon = milestoneIcon(kind, isFoundingMember);

    return (
      <View
        ref={ref}
        style={[styles.wrapper, { width: size, height: size }]}
        accessibilityLabel={`Trophy card: ${headline} — ${subtitle}`}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.gradient}
        >
          {/* ── Founding ribbon ── */}
          {isFoundingMember && (
            <View style={styles.ribbon}>
              <Text style={[styles.ribbonText, { fontSize: 10 * previewScale }]}>
                ★ FOUNDING MEMBER ★
              </Text>
            </View>
          )}

          {/* ── Icon ── */}
          <Text style={[styles.icon, { fontSize: 52 * previewScale }]}>{icon}</Text>

          {/* ── Headline ── */}
          <Text
            style={[
              styles.headline,
              { fontSize: (kind === 'streak' ? 72 : 40) * previewScale },
            ]}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {headline}
          </Text>

          {/* ── Subtitle ── */}
          <Text style={[styles.subtitle, { fontSize: 15 * previewScale }]}>
            {subtitle}
          </Text>

          {/* ── Divider line ── */}
          <View
            style={[
              styles.divider,
              { backgroundColor: accentColor, marginVertical: 12 * previewScale },
            ]}
          />

          {/* ── Identity title ── */}
          <View
            style={[
              styles.identityPill,
              {
                backgroundColor: `rgba(255,255,255,0.15)`,
                borderColor: accentColor,
                paddingVertical: 6 * previewScale,
                paddingHorizontal: 18 * previewScale,
                borderRadius: 100,
              },
            ]}
          >
            <Text
              style={[
                styles.identityLabel,
                { fontSize: 9 * previewScale, color: accentColor },
              ]}
            >
              IDENTITY
            </Text>
            <Text
              style={[
                styles.identityValue,
                { fontSize: 18 * previewScale, color: '#FFFFFF' },
              ]}
            >
              {identityTitle}
            </Text>
          </View>

          {/* ── Footer ── */}
          <Text
            style={[styles.footer, { fontSize: 11 * previewScale, color: accentColor }]}
          >
            @theGrowthProject
          </Text>
        </LinearGradient>
      </View>
    );
  },
);

TrophyArtifact.displayName = 'TrophyArtifact';
export default TrophyArtifact;

// ─── HTML template for expo-print ─────────────────────────────────────────────

/**
 * Generates a 1080×1080 HTML page that mirrors the TrophyArtifact card.
 * Passed to expo-print to produce a PDF/PNG suitable for saving or sharing.
 */
export function buildTrophyHtml(props: Omit<TrophyArtifactProps, 'previewScale'>): string {
  const { kind, headline, subtitle, identityTitle, isFoundingMember = false } = props;

  const gradientStops = isFoundingMember
    ? '#3D2800, #7A5214, #C4922A, #E9C46A'
    : '#1B4332, #2D6A4F, #40916C, #52B788';

  const accentColor = isFoundingMember ? '#E9C46A' : '#52B788';
  const icon = milestoneIcon(kind, isFoundingMember);
  const headlineFontSize = kind === 'streak' ? '128px' : '72px';
  const ribbonHtml = isFoundingMember
    ? `<div class="ribbon">★ FOUNDING MEMBER ★</div>`
    : '';

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
      background: linear-gradient(135deg, ${gradientStops});
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }
    .ribbon {
      position: absolute;
      top: 56px;
      background: rgba(255,255,255,0.18);
      border: 1px solid ${accentColor};
      border-radius: 100px;
      padding: 8px 32px;
      color: ${accentColor};
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 3px;
    }
    .icon {
      font-size: 120px;
      margin-bottom: 16px;
    }
    .headline {
      font-size: ${headlineFontSize};
      font-weight: 800;
      color: #FFFFFF;
      text-align: center;
      letter-spacing: -2px;
      line-height: 1;
      padding: 0 64px;
      margin-bottom: 12px;
    }
    .subtitle {
      font-size: 32px;
      font-weight: 600;
      color: rgba(255,255,255,0.85);
      text-align: center;
      letter-spacing: 0.5px;
      margin-bottom: 24px;
    }
    .divider {
      width: 120px;
      height: 2px;
      background: ${accentColor};
      margin-bottom: 24px;
    }
    .identity-pill {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: rgba(255,255,255,0.15);
      border: 1.5px solid ${accentColor};
      border-radius: 100px;
      padding: 14px 48px;
      margin-bottom: 56px;
    }
    .identity-label {
      font-size: 18px;
      font-weight: 700;
      color: ${accentColor};
      letter-spacing: 4px;
      margin-bottom: 4px;
    }
    .identity-value {
      font-size: 36px;
      font-weight: 800;
      color: #FFFFFF;
    }
    .footer {
      position: absolute;
      bottom: 56px;
      font-size: 22px;
      font-weight: 600;
      color: ${accentColor};
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  ${ribbonHtml}
  <div class="icon">${icon}</div>
  <div class="headline">${headline}</div>
  <div class="subtitle">${subtitle}</div>
  <div class="divider"></div>
  <div class="identity-pill">
    <div class="identity-label">IDENTITY</div>
    <div class="identity-value">${identityTitle}</div>
  </div>
  <div class="footer">@theGrowthProject</div>
</body>
</html>`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: tokens.radius.xl,  // 16
    overflow: 'hidden',
    ...tokens.shadows['glow-gold'],
  },
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  ribbon: {
    position: 'absolute',
    top: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 100,
    paddingVertical: 5,
    paddingHorizontal: 14,
  },
  ribbonText: {
    fontWeight: '700',
    letterSpacing: 2,
    color: gold[400],
  },
  icon: {
    marginBottom: 4,
  },
  headline: {
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -1.5,
    lineHeight: undefined,
    marginBottom: 4,
  },
  subtitle: {
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  divider: {
    width: 48,
    height: 1.5,
  },
  identityPill: {
    alignItems: 'center',
    borderWidth: 1.5,
  },
  identityLabel: {
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 1,
  },
  identityValue: {
    fontWeight: '800',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
