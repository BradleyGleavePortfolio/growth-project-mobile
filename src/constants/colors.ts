/**
 * Canonical Colors — The Growth Project
 * Wave 2: Luxury repositioning — bone/cream/ink/forest palette.
 * Old keys are preserved for back-compat; values updated to new system.
 */

export const Colors = {
  // Primary brand → forest
  primary:       '#2C4A36',  // forest (was #2D6A4F)
  primaryLight:  '#4D7059',  // forest light tint (was #52B788)
  primaryPale:   '#D6E4DA',  // forest pale (was #D8F3DC)
  primaryDark:   '#1C3023',  // forest dark (was #1B4332)
  accent:        '#3A5C46',  // forest mid (was #40916C)

  // Backgrounds → bone/cream
  background:        '#F5EFE4',  // bone (was #FAF8F3)
  surface:           '#F1E8D5',  // cream (was #FFFFFF)
  surfaceElevated:   '#F1E8D5',  // cream (was #F5F0E8)

  // Text → ink/charcoal/stone
  textPrimary:    '#1A1A18',  // ink (was #1B2B1E)
  textSecondary:  '#3D3D3A',  // charcoal (was #4A6358)
  textMuted:      '#B1A89F',  // stone (was #8FA89A)
  textOnPrimary:  '#F5EFE4',  // bone on dark bg (was #FFFFFF)

  // Borders & dividers → stone/camel
  border:   '#B08D57',  // camel hairlines (was #E2EDE6)
  divider:  'rgba(176,141,87,0.2)',  // camel at low opacity (was #EDF2EF)

  // Semantic
  success: '#2C4A36',  // forest
  warning: '#C5A253',  // mutedGold (was #E9C46A)
  error:   '#4A0404',  // oxblood (was #E63946)
  info:    '#457B9D',  // unchanged

  // Streak/flame — demoted, kept for back-compat (Wave 3 copy pass will remove)
  streak: '#B1A89F',   // stone — neutralised (was #E76F51)

  // Macros — kept for chart/bar use
  protein: '#2C4A36',  // forest
  carbs:   '#457B9D',  // info blue
  fat:     '#C5A253',  // mutedGold
  water:   '#4D7059',  // forest light
  fiber:   '#6E9479',  // forest mid-light

  // Tab bar
  tabActive:      '#2C4A36',  // forest
  tabInactive:    '#B1A89F',  // stone
  tabBackground:  '#F5EFE4',  // bone
  tabBorder:      'rgba(176,141,87,0.3)',  // camel

  // Cards
  cardShadow: 'rgba(26,26,24,0.06)',  // ink at low opacity

  // Status / system UI
  offlineBanner:  '#8A6A2A',   // warm gold-brown for offline banner
  primaryTint:    'rgba(44,74,54,0.06)',  // forest soft tint

  // Alert/notice palettes — neutralised to bone system
  noticeWarningBg:       '#F8F2E5',
  noticeWarningIconBg:   '#F3EBD8',
  noticeWarningText:     '#8A6A2A',
  noticeCriticalBg:      '#F2E0E0',
  noticeCriticalAccent:  '#9A3030',
  noticeCriticalText:    '#4A0404',

  // Macro chip tints — subtle versions
  macroCarbsChipBg:   '#E3EDF5',
  macroCarbsChipText: '#1E4971',
  macroFatChipBg:     '#F3EBD8',
  macroFatChipText:   '#8A6A2A',

  // Program template category accents (coach-side) — kept for back-compat
  templateFatLoss:    '#9A3030',  // oxblood-adjacent
  templateLeanBulk:   '#2C4A36',  // forest
  templateRecomp:     '#457B9D',  // info blue
  templateMaintenance:'#6E9479',  // forest mid-light
  templateMobility:   '#7A6A9B',  // muted lavender

  // Leaderboard medals — kept, slightly desaturated
  medalGold:   '#C5A253',  // mutedGold
  medalSilver: '#B1A89F',  // stone
  medalBronze: '#9A7240',  // warm brown

  // Muscle-group accents (workout screens) — kept for data-viz use
  muscleLegs:     '#2A9D8F',
  muscleTriceps:  '#B07040',
  muscleCore:     '#264653',
  muscleFullBody: '#6A5085',
  muscleCardio:   '#2C4A36',  // forest
};

export default Colors;
