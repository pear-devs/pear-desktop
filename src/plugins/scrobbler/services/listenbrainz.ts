import { net } from 'electron';

import { APPLICATION_NAME } from '@/i18n';

import { ScrobblerBase } from './base';

import { scrobblerDebug } from '../scrobble-manager';

import type { ScrobblerPluginConfig } from '../index';
import type { SetConfType } from '../main';
import type { SongInfo } from '@/providers/song-info';

interface ListenbrainzRequestBody {
  listen_type?: string;
  payload: {
    track_metadata?: {
      artist_name?: string;
      track_name?: string;
      release_name?: string;
      additional_info?: {
        media_player?: string;
        submission_client?: string;
        origin_url?: string;
        duration?: number;
      };
    };
    listened_at?: number;
  }[];
}

export class ListenbrainzScrobbler extends ScrobblerBase {
  override isSessionCreated(): boolean {
    return true;
  }

  override createSession(
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType,
  ): Promise<ScrobblerPluginConfig> {
    return Promise.resolve(config);
  }

  override setNowPlaying(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType,
  ): void {
    if (
      !config.scrobblers.listenbrainz.apiRoot ||
      !config.scrobblers.listenbrainz.token
    ) {
      return;
    }

    const body = createRequestBody('playing_now', songInfo, config);
    submitListen(body, config);
  }

  override addScrobble(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType,
    startedAtSeconds: number,
  ): void {
    if (
      !config.scrobblers.listenbrainz.apiRoot ||
      !config.scrobblers.listenbrainz.token
    ) {
      return;
    }

    const body = createRequestBody('single', songInfo, config);
    body.payload[0].listened_at = Math.trunc(startedAtSeconds);

    submitListen(body, config).then((msid) => {
      if (msid) {
        rememberMsid(songKey(songInfo), msid);
        scrobblerDebug(`[listenbrainz] listen submitted, cached msid ${msid}`);
      }
    });
  }

  override love(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType,
  ): void {
    submitFeedback(songInfo, config, 1);
  }

  override unlove(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType,
  ): void {
    submitFeedback(songInfo, config, 0);
  }
}

// ListenBrainz feedback needs a recording_msid, only known after a listen is
// submitted. Cache it per song, bounded so it can't grow forever.
const MAX_MSID_ENTRIES = 200;
const msidCache = new Map<string, string>();

const songKey = (songInfo: SongInfo): string =>
  songInfo.videoId || `${songInfo.artist}|${songInfo.title}`;

function rememberMsid(key: string, msid: string): void {
  if (msidCache.has(key)) msidCache.delete(key);
  msidCache.set(key, msid);
  while (msidCache.size > MAX_MSID_ENTRIES) {
    msidCache.delete(msidCache.keys().next().value!);
  }
}

function submitFeedback(
  songInfo: SongInfo,
  config: ScrobblerPluginConfig,
  score: number,
): void {
  const { apiRoot, token } = config.scrobblers.listenbrainz;
  if (!apiRoot || !token) return;

  const msid = msidCache.get(songKey(songInfo));
  if (!msid) {
    scrobblerDebug(
      `[listenbrainz] no cached msid for "${songInfo.title}", skipping feedback`,
    );
    return;
  }

  scrobblerDebug(`[listenbrainz] feedback score=${score} for msid ${msid}`);
  net
    .fetch(apiRoot + 'feedback/recording-feedback', {
      method: 'POST',
      body: JSON.stringify({ recording_msid: msid, score }),
      headers: {
        'Authorization': 'Token ' + token,
        'Content-Type': 'application/json',
      },
    })
    .catch(console.error);
}

function createRequestBody(
  listenType: string,
  songInfo: SongInfo,
  config: ScrobblerPluginConfig,
): ListenbrainzRequestBody {
  const title =
    config.alternativeTitles && songInfo.alternativeTitle !== undefined
      ? songInfo.alternativeTitle
      : songInfo.title;

  const artist =
    config.alternativeArtist && songInfo.tags?.at(0) !== undefined
      ? songInfo.tags?.at(0)
      : songInfo.artist;

  const trackMetadata = {
    artist_name: artist,
    track_name: title,
    release_name: songInfo.album ?? undefined,
    additional_info: {
      media_player: `${APPLICATION_NAME} Desktop App`,
      submission_client: `${APPLICATION_NAME} Desktop App - Scrobbler Plugin`,
      origin_url: songInfo.url,
      duration: songInfo.songDuration,
    },
  };

  return {
    listen_type: listenType,
    payload: [
      {
        track_metadata: trackMetadata,
      },
    ],
  };
}

async function submitListen(
  body: ListenbrainzRequestBody,
  config: ScrobblerPluginConfig,
): Promise<string | undefined> {
  try {
    const response = await net.fetch(
      config.scrobblers.listenbrainz.apiRoot + 'submit-listens',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Authorization': 'Token ' + config.scrobblers.listenbrainz.token,
          'Content-Type': 'application/json',
        },
      },
    );
    const json = (await response.json()) as {
      payload?: { latest_listen_recording_msid?: string }[];
    };
    return json?.payload?.[0]?.latest_listen_recording_msid;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}
