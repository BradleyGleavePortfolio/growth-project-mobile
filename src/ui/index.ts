/**
 * Shared client primitives (DS-PRIMITIVES-133; absorbs QA-PRIM-128). Screens
 * build from these instead of writing their own wrapper, button or headline.
 * See src/components/README.md and src/theme/README.md for the rules.
 */
export { Screen, ScreenTopBar, useScreenInsets, footerBottomPadding } from './layout/Screen';
export type { ScreenProps, ScreenTopBarProps, ScreenEdge } from './layout/Screen';
export { PrimaryButton, TextLink, QuietTextButton } from './buttons/PrimaryButton';
export type { PrimaryButtonProps, TextLinkProps, TextLinkTone } from './buttons/PrimaryButton';
export { Headline, Lede, AccentRule } from './text/Headline';
export type { HeadlineProps, LedeProps } from './text/Headline';
export { QuietSection, QuietOverline, QuietOverline as Overline, quietActions } from './sections/QuietSection';
