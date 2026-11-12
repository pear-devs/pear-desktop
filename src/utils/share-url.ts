export const stripMusicFromShareUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.hostname !== 'music.youtube.com'
    ) {
      return value;
    }

    url.hostname = 'youtube.com';
    return url.href;
  } catch {
    return value;
  }
};
