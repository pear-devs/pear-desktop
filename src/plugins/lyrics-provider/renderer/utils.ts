import { LyricsProviderAPI } from "../types";

export const getLyricsProvider = () => (window as any).lyricsProvider as LyricsProviderAPI;