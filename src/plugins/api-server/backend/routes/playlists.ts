type JsonRecord = Record<string, unknown>;

export type LibraryPlaylist = {
  playlistId: string;
  title?: string;
  subtitle?: string;
};

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const getText = (value: unknown) => {
  const runs = asRecord(value)?.runs;
  if (!Array.isArray(runs)) return undefined;

  const text = runs
    .map((run) => asRecord(run)?.text)
    .filter((run): run is string => typeof run === 'string')
    .join('');

  return text || undefined;
};

const getPlaylist = (value: unknown): LibraryPlaylist | undefined => {
  const renderer = asRecord(asRecord(value)?.musicTwoRowItemRenderer);
  const title = renderer?.title;
  const titleRuns = asRecord(title)?.runs;
  const firstRun = Array.isArray(titleRuns)
    ? asRecord(titleRuns[0])
    : undefined;
  const browseEndpoint = asRecord(
    asRecord(firstRun?.navigationEndpoint)?.browseEndpoint,
  );
  const browseId = browseEndpoint?.browseId;

  if (
    typeof browseId !== 'string' ||
    !browseId.startsWith('VL') ||
    browseId.length === 2
  ) {
    return undefined;
  }

  return {
    playlistId: browseId.slice(2),
    title: getText(title),
    subtitle: getText(renderer?.subtitle),
  };
};

export const parseLibraryPlaylists = (response: unknown) => {
  const items: LibraryPlaylist[] = [];
  const playlistIds = new Set<string>();
  let continuation: string | undefined;

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    const playlist = getPlaylist(record);
    if (playlist && !playlistIds.has(playlist.playlistId)) {
      playlistIds.add(playlist.playlistId);
      items.push(playlist);
    }

    const nextContinuationData = asRecord(record.nextContinuationData);
    if (
      !continuation &&
      typeof nextContinuationData?.continuation === 'string'
    ) {
      continuation = nextContinuationData.continuation;
    }

    Object.values(record).forEach(visit);
  };

  visit(response);
  return { items, continuation };
};
