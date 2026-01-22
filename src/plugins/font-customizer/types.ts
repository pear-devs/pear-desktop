export type FontMode = 'simple' | 'advanced';

export interface FontCustomizerConfig {
  enabled: boolean;
  mode: FontMode;
  /** Applied to entire app when in simple mode */
  globalFont: string;
  /** Applied to general UI text in advanced mode (playlists, sidebar, etc.) */
  primaryFont: string;
  /** Applied to section headers in advanced mode */
  headerFont: string;
  /** Applied to now-playing title in player bar and player page */
  titleFont: string;
  /** Applied to artist/byline in player bar and player page */
  artistFont: string;
  /** Applied to synced lyrics and the lyrics tab */
  lyricsFont: string;
  /** Applied to top navigation bar menu items (Plugins, Options, View, etc.) */
  menuFont: string;
  /** Stores a list of user-added fonts */
  customFonts: string[];
}

export const popularFonts: string[] = [
  'System Default',
  'Roboto',
  'Inter',
  'Open Sans',
  'Montserrat',
  'Poppins',
  'Noto Sans',
  'Noto Serif',
  'Merriweather',
  'Lora',
  'Source Sans 3',
  'Source Serif 4',
  'Oswald',
  'Raleway',
  'Nunito',
  'Work Sans',
  'Fira Sans',
  'PT Sans',
  'PT Serif',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'Space Grotesk',
  'Space Mono',
  'JetBrains Mono',
  'Inconsolata',
];
