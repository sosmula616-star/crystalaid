export type ThemeId = 'crystal' | 'indigo' | 'amber' | 'emerald' | 'graphite' | 'raspberry';

export interface ThemeTokens {
  background: string;
  surface: string;
  'surface-elevated': string;
  'surface-hover': string;
  border: string;
  foreground: string;
  muted: string;
  primary: string;
  'on-primary': string;
  success: string;
  warning: string;
  danger: string;
}

export interface Theme {
  id: ThemeId;
  nameKey: `theme.${ThemeId}`;
  free: boolean;
  tokens: ThemeTokens;
}

const STATUS = { success: '#5BD6A0', warning: '#F5C451', danger: '#F47174' } as const;

// Values come from section 9 of the staff design spec. surface-hover continues the
// surface -> surface-elevated step once more; border is a decorative mid tone.
export const THEMES: readonly Theme[] = [
  {
    id: 'crystal',
    nameKey: 'theme.crystal',
    free: true,
    tokens: {
      background: '#0B1220',
      surface: '#111A2C',
      'surface-elevated': '#18233A',
      'surface-hover': '#1F2C48',
      border: '#2A3A5A',
      foreground: '#EAF1FA',
      muted: '#9AACC6',
      primary: '#6FD3F7',
      'on-primary': '#06263A',
      ...STATUS,
    },
  },
  {
    id: 'indigo',
    nameKey: 'theme.indigo',
    free: false,
    tokens: {
      background: '#12131F',
      surface: '#191A2B',
      'surface-elevated': '#212338',
      'surface-hover': '#292C45',
      border: '#34375A',
      foreground: '#ECEDF8',
      muted: '#9EA1C0',
      primary: '#8E8CFF',
      'on-primary': '#10102C',
      ...STATUS,
    },
  },
  {
    id: 'amber',
    nameKey: 'theme.amber',
    free: false,
    tokens: {
      background: '#171412',
      surface: '#1F1B18',
      'surface-elevated': '#28231F',
      'surface-hover': '#312B26',
      border: '#40382F',
      foreground: '#F3EEE9',
      muted: '#AEA399',
      primary: '#F2B04A',
      'on-primary': '#2B1A00',
      ...STATUS,
    },
  },
  {
    id: 'emerald',
    nameKey: 'theme.emerald',
    free: false,
    tokens: {
      background: '#0F1614',
      surface: '#151F1C',
      'surface-elevated': '#1C2925',
      'surface-hover': '#23332E',
      border: '#2F443D',
      foreground: '#E8F2EE',
      muted: '#93A8A0',
      primary: '#3FD9A4',
      'on-primary': '#04291D',
      ...STATUS,
    },
  },
  {
    id: 'graphite',
    nameKey: 'theme.graphite',
    free: false,
    tokens: {
      background: '#121416',
      surface: '#181B1E',
      'surface-elevated': '#1F2327',
      'surface-hover': '#262B30',
      border: '#363C42',
      foreground: '#EDF0F2',
      muted: '#99A2AA',
      primary: '#C6F24E',
      'on-primary': '#1A2200',
      ...STATUS,
    },
  },
  {
    id: 'raspberry',
    nameKey: 'theme.raspberry',
    free: false,
    tokens: {
      background: '#1A1216',
      surface: '#23191E',
      'surface-elevated': '#2D2127',
      'surface-hover': '#372930',
      border: '#49363F',
      foreground: '#F6EAF0',
      muted: '#B59DA9',
      primary: '#F2618F',
      'on-primary': '#34061A',
      ...STATUS,
    },
  },
];

const DEFAULT_THEME: ThemeId = 'crystal';

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** Sets data-theme on the root; an unknown id falls back to crystal. */
export function applyTheme(
  id: string,
  root: { dataset: DOMStringMap | Record<string, string | undefined> } = document.documentElement,
): ThemeId {
  const resolved = isThemeId(id) ? id : DEFAULT_THEME;
  root.dataset.theme = resolved;
  return resolved;
}
