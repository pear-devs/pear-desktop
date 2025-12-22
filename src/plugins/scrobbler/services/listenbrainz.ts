import { net } from 'electron';

import { ScrobblerBase } from './base';

import type { SetConfType } from '../main';
import type { SongInfo } from '@/providers/song-info';
import type { ScrobblerPluginConfig } from '../index';
import { APPLICATION_NAME } from '@/i18n';

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
  ): void {
    if (
      !config.scrobblers.listenbrainz.apiRoot ||
      !config.scrobblers.listenbrainz.token
    ) {
      return;
    }

    const body = createRequestBody('single', songInfo, config);
    body.payload[0].listened_at = Math.trunc(Date.now() / 1000);

    submitListen(body, config);
  }
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

function submitListen(
  body: ListenbrainzRequestBody,
  config: ScrobblerPluginConfig,
) {
  net
    .fetch(config.scrobblers.listenbrainz.apiRoot + 'submit-listens', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Authorization': 'Token ' + config.scrobblers.listenbrainz.token,
        'Content-Type': 'application/json',
      },
    })
    .catch(console.error);
}
