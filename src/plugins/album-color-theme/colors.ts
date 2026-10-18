import Color, { type ColorInstance } from 'color';
import { FastAverageColor } from 'fast-average-color';

/** Where the theme keeps its colours, as "r, g, b" */
export const COLOR_KEY = '--ytmusic-album-color';
export const DARK_COLOR_KEY = '--ytmusic-album-color-dark';

const fastAverageColor = new FastAverageColor();

const rgb = (color: ColorInstance) =>
  `${~~color.red()}, ${~~color.green()}, ${~~color.blue()}`;

/** The theme's colour and dark colour for an artwork, null if unreadable */
export const albumColors = async (url: string) => {
  const albumColor = await fastAverageColor.getColorAsync(url).catch((err) => {
    console.error(err);
    return null;
  });
  if (!albumColor) return null;

  const target = Color(albumColor.hex);
  let darkColor = target.darken(0.3).rgb();
  let color = target.darken(0.15).rgb();
  while (color.luminosity() > 0.5) {
    color = color.darken(0.05);
    darkColor = darkColor.darken(0.05);
  }
  return { color: rgb(color), dark: rgb(darkColor) };
};
