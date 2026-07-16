import type { PlayRecord } from './types';

export interface StreakData {
  lastListenDate: string; // local YYYY-MM-DD
  currentStreak: number;
}

interface DatabaseSchema {
  playRecords: PlayRecord[];
  streak: StreakData | null;
  artistImages: Record<string, string>;
}

export interface ExportPayload {
  version: number;
  exportDate: number;
  playRecords: PlayRecord[];
  streak: StreakData | null;
  artistImages: Record<string, string>;
}

// A play is identified by what was played and when it started. Two machines
// can never produce the same song at the same millisecond, so this is a
// stable dedupe key for merging.
export const recordKey = (r: PlayRecord) => `${r.songId}|${r.timestamp}`;

export class StatsDatabase {
  private dbPath: string;
  private data: DatabaseSchema;
  private saveTimer?: NodeJS.Timeout;
  private isDirty = false;
  private revision = 0;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.data = emptyData();
  }

  /**
   * Incremented on every mutation; used by the backend to invalidate
   * computed-stats caches without re-reading the whole record list.
   */
  getRevision() {
    return this.revision;
  }

  async initialize() {
    const fs = (await import('node:fs/promises')).default;

    this.data = emptyData();
    for (const candidate of [this.dbPath, `${this.dbPath}.bak`]) {
      try {
        const fileData = await fs.readFile(candidate, 'utf-8');
        this.data = normalizeDatabaseData(JSON.parse(fileData));
        break;
      } catch {
        // Missing or corrupt — try the backup next.
      }
    }

    // Records must stay chronological for the stats computations.
    this.data.playRecords.sort((a, b) => a.timestamp - b.timestamp);

    this.saveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save().catch(console.error);
      }
    }, 30000);
  }

  private async save() {
    try {
      const fs = (await import('node:fs/promises')).default;
      const path = (await import('node:path')).default;

      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

      // Atomic write: never leave a half-written stats file behind, and keep
      // the previous good version as .bak so a crash can't wipe history.
      const tmpPath = `${this.dbPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(this.data), 'utf-8');
      try {
        await fs.rename(this.dbPath, `${this.dbPath}.bak`);
      } catch {
        // First save — nothing to back up yet.
      }
      await fs.rename(tmpPath, this.dbPath);
      this.isDirty = false;
    } catch (error) {
      console.error('[Music Stats] Failed to save database:', error);
    }
  }

  private markDirty() {
    this.isDirty = true;
    this.revision++;
  }

  async addPlayRecord(record: PlayRecord): Promise<void> {
    this.data.playRecords.push(record);
    this.markDirty();
  }

  /** Bulk insert for synced/imported plays; restores chronological order. */
  async addPlayRecords(records: PlayRecord[]): Promise<void> {
    if (!records.length) return;
    this.data.playRecords.push(...records);
    this.data.playRecords.sort((a, b) => a.timestamp - b.timestamp);
    this.markDirty();
  }

  async getPlayRecords(
    startDate?: number,
    endDate?: number,
  ): Promise<PlayRecord[]> {
    let records = this.data.playRecords;
    if (startDate !== undefined || endDate !== undefined) {
      records = records.filter(
        (r) =>
          (startDate === undefined || r.timestamp >= startDate) &&
          (endDate === undefined || r.timestamp <= endDate),
      );
    }
    return records;
  }

  async updateStreak(date: string, streak: number): Promise<void> {
    this.data.streak = { lastListenDate: date, currentStreak: streak };
    this.markDirty();
  }

  async getStreak(): Promise<StreakData | null> {
    return this.data.streak;
  }

  getArtistImage(key: string): string | undefined {
    return this.data.artistImages[key];
  }

  setArtistImage(key: string, url: string) {
    if (this.data.artistImages[key] === url) return;
    this.data.artistImages[key] = url;
    this.markDirty();
  }

  async exportData(): Promise<string> {
    const payload: ExportPayload = {
      version: 2,
      exportDate: Date.now(),
      playRecords: this.data.playRecords,
      streak: this.data.streak,
      artistImages: this.data.artistImages,
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Deterministic representation of the actual content (no exportDate),
   * so sync hashing doesn't see "changes" that are just timestamps.
   */
  contentFingerprint(): string {
    return JSON.stringify({
      playRecords: this.data.playRecords,
      streak: this.data.streak,
    });
  }

  /**
   * Imports are always additive merges — never a destructive replace.
   * Records are deduped by songId+timestamp.
   */
  async importData(jsonData: string): Promise<{ added: number }> {
    const imported = normalizeDatabaseData(JSON.parse(jsonData));

    const existing = new Set(this.data.playRecords.map(recordKey));
    let added = 0;
    for (const record of imported.playRecords) {
      if (!isValidRecord(record) || existing.has(recordKey(record))) continue;
      existing.add(recordKey(record));
      this.data.playRecords.push(record);
      added++;
    }
    this.data.playRecords.sort((a, b) => a.timestamp - b.timestamp);

    this.data.streak = pickNewerStreak(this.data.streak, imported.streak);
    this.data.artistImages = {
      ...imported.artistImages,
      ...this.data.artistImages,
    };

    this.markDirty();
    await this.save();
    return { added };
  }

  async close() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.isDirty) {
      await this.save();
    }
  }
}

export function pickNewerStreak(
  a: StreakData | null,
  b: StreakData | null,
): StreakData | null {
  if (!a) return b;
  if (!b) return a;
  return a.lastListenDate >= b.lastListenDate ? a : b;
}

function isValidRecord(record: unknown): record is PlayRecord {
  const r = record as Partial<PlayRecord> | null;
  return (
    !!r &&
    typeof r.songId === 'string' &&
    typeof r.songTitle === 'string' &&
    typeof r.timestamp === 'number' &&
    Number.isFinite(r.timestamp) &&
    typeof r.durationListened === 'number' &&
    Number.isFinite(r.durationListened)
  );
}

function emptyData(): DatabaseSchema {
  return { playRecords: [], streak: null, artistImages: {} };
}

function normalizeDatabaseData(input: unknown): DatabaseSchema {
  const data = (input || {}) as Partial<DatabaseSchema>;
  return {
    playRecords: Array.isArray(data.playRecords)
      ? data.playRecords.filter(isValidRecord)
      : [],
    streak:
      data.streak &&
      typeof data.streak.lastListenDate === 'string' &&
      typeof data.streak.currentStreak === 'number'
        ? data.streak
        : null,
    artistImages:
      data.artistImages && typeof data.artistImages === 'object'
        ? data.artistImages
        : {},
  };
}
