export interface StatsConfig {
  enabled: boolean;
  remoteSyncEnabled?: boolean;
  remoteSyncLastTime?: string;
  remoteSyncLastError?: string;
  cloudSyncEnabled: boolean;
  cloudSyncClientId?: string;
  cloudSyncClientSecret?: string;
  cloudSyncRefreshToken?: string;
  cloudSyncAccessToken?: string;
  cloudSyncAccessTokenExpiry?: number;
  cloudSyncFileId?: string;
  cloudSyncLastSyncTime?: string;
  cloudSyncLastHash?: string;
  cloudSyncLastError?: string;
}

export interface PlayRecord {
  songId: string;
  songTitle: string;
  artistId: string;
  artistName: string;
  artistImageUrl?: string;
  albumName?: string;
  thumbnailUrl?: string;
  timestamp: number;
  durationListened: number; // in seconds
  totalDuration: number; // in seconds
  skipped: boolean;
  completed: boolean;
  mediaType?: string;
  /** Where this play was observed. Absent = tracked locally on this PC. */
  source?: 'local' | 'history' | 'takeout';
  /**
   * True when only the day is known (account history without a live
   * detection). These plays are excluded from hour-of-day stats.
   */
  approximateTime?: boolean;
}

export type StatsRange = 'week' | 'month' | 'year' | 'all';

export interface RankedSong {
  id: string;
  title: string;
  artist: string;
  plays: number;
  minutes: number;
  imageUrl?: string;
}

export interface RankedArtist {
  id: string;
  name: string;
  plays: number;
  minutes: number;
  imageUrl?: string;
}

export interface StatsData {
  range: StatsRange;
  totalMinutes: number;
  totalPlays: number;
  uniqueSongs: number;
  uniqueArtists: number;
  topSongs: RankedSong[];
  topArtists: RankedArtist[];
  anthem?: { id: string; title: string; artist: string; plays: number };
  peakListeningDay?: { date: string; minutes: number };
  listeningClock: number[]; // 24 hours, minutes per hour
  dailyTrend: Array<{ date: string; minutes: number }>; // last 30 days
  currentStreak: number;
  firstSongEver?: { title: string; artist: string; date: string };
  firstSongThisYear?: { title: string; artist: string; date: string };
  firstSongThisMonth?: { title: string; artist: string; date: string };
  monthlyObsessions: Array<{
    yearMonth: string;
    artist: string;
    minutes: number;
  }>;
  skipStats: Array<{
    songId: string;
    title: string;
    artist: string;
    skips: number;
    plays: number;
    imageUrl?: string;
  }>;
  skipRate: number;
}
