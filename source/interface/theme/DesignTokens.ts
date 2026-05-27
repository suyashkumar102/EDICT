/**
 * Design tokens. The Command Center is built from a small palette to
 * keep the look cohesive across the eight surfaces (Composer, What-If,
 * Audit, Leaderboard, Briefing, Gallery, Settings, Reverse). Devvit's
 * Blocks runtime supports a constrained set of style properties; these
 * tokens are the union of "things Blocks accepts" and "things we
 * actually use".
 *
 * The palette is built around a slate-and-emerald scheme that survives
 * Reddit's light/dark theme switch without contrast issues.
 */

export const color = {
  // brand
  edictPrimary: '#0E7C66',
  edictPrimaryHover: '#0A604F',
  edictAccent: '#F4A52A',

  // text
  textBody: '#1F2937',
  textMuted: '#6B7280',
  textInverse: '#FFFFFF',

  // surfaces
  surfaceCanvas: '#F8FAFC',
  surfaceCard: '#FFFFFF',
  surfaceRaised: '#E2E8F0',

  // borders
  borderSubtle: '#E5E7EB',
  borderStrong: '#9CA3AF',

  // semantic
  semanticGood: '#0E7C66',
  semanticWarn: '#D97706',
  semanticDanger: '#DC2626',
  semanticInfo: '#2563EB',

  // shadow phase
  phaseDraft: '#94A3B8',
  phaseShadow: '#D97706',
  phaseLive: '#0E7C66',
  phasePaused: '#6B7280',
  phaseArchived: '#9CA3AF',
} as const;

export const spacing = {
  xs: 'small',
  sm: 'small',
  md: 'medium',
  lg: 'large',
  xl: 'large',
} as const;

export const radius = {
  card: 'medium',
  pill: 'full',
  button: 'medium',
} as const;

export const typography = {
  headlineSize: 'xlarge',
  titleSize: 'large',
  bodySize: 'medium',
  captionSize: 'small',
  weightBold: 'bold',
  weightMedium: 'regular',
} as const;

export const phaseColor = (phase: string): string => {
  switch (phase) {
    case 'drafted':
      return color.phaseDraft;
    case 'shadowed':
      return color.phaseShadow;
    case 'live':
      return color.phaseLive;
    case 'paused':
      return color.phasePaused;
    case 'archived':
      return color.phaseArchived;
    default:
      return color.textMuted;
  }
};

export const gradeColor = (grade: string): string => {
  switch (grade) {
    case 'excellent':
      return color.semanticGood;
    case 'strong':
      return color.edictPrimary;
    case 'fair':
      return color.semanticInfo;
    case 'weak':
      return color.semanticWarn;
    case 'failing':
      return color.semanticDanger;
    default:
      return color.textMuted;
  }
};
