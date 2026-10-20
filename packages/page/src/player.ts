// The page-side player facade over YTM's `#movie_player` API and <video>.
// It owns the NowPlaying state, mirrors it to the host, and executes
// PlayerActions coming from plugins or the host.

import {
  IDLE,
  type LikeStatus,
  type MediaType,
  type NowPlaying,
  type PagePlayer,
  type PlaybackStatus,
  type PlayerAction,
  type RepeatMode,
  type Track,
  type Unsubscribe,
  type YTPlayerApi,
  type YTPlayerResponse,
} from "@pear/sdk";
import { selectors, type SelectorName } from "@pear/sdk/selectors";
import { clamp, isPlaying, sleep, ytmUrl } from "@pear/sdk/util";
import { waitForSelector } from "./dom.ts";
import { Emitter } from "./emitter.ts";

export type PlayerEvents = {
  trackLoading: (videoId: string) => void;
  trackChange: (track: Track) => void;
  statusChange: (status: PlaybackStatus) => void;
  timeUpdate: (seconds: number) => void;
  adChange: (ad: boolean) => void;
  volumeChange: (volume: number, muted: boolean) => void;
  change: (state: NowPlaying) => void;
};

// YTM sometimes never fires "dataupdated" after "dataloaded".
const DATAUPDATED_FALLBACK_MS = 1500;
// The player element exists before YTM upgrades it with the API methods.
const API_POLL_MS = 50;

const MEDIA_TYPES: Record<string, MediaType> = {
  MUSIC_VIDEO_TYPE_ATV: "audio",
  MUSIC_VIDEO_TYPE_OMV: "video",
  MUSIC_VIDEO_TYPE_UGC: "video",
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: "podcast",
};

const REPEAT_MODES: Record<string, RepeatMode> = { NONE: "none", ALL: "all", ONE: "one" };

/** The like buttons' `like-status` attribute. */
const LIKE_STATUS: Record<string, LikeStatus> = { LIKE: "like", DISLIKE: "dislike" };

/** Sends states to the host: `now` at once, `batched` at most once in a while (position-only updates). */
export interface StatePublisher {
  now(state: NowPlaying): void;
  batched(state: NowPlaying): void;
}

interface PlayerBarElement extends HTMLElement {
  getState?(): { queue?: { repeatMode?: string } };
  updateVolume?(volume: number): void;
}

export class Player implements PagePlayer {
  #emitter = new Emitter<PlayerEvents>();
  #api: YTPlayerApi | null = null;
  #ready: Promise<YTPlayerApi>;
  #videoReady: Promise<HTMLVideoElement>;
  #state: NowPlaying = { ...IDLE };
  #publisher: StatePublisher;
  /** The core's appearance section (usePodcastParticipantAsArtist). */
  #options: Record<string, unknown>;

  constructor(publisher: StatePublisher, options: Record<string, unknown> = {}) {
    this.#publisher = publisher;
    this.#options = options;
    this.#ready = this.#findApi().then((api) => {
      this.#api = api;
      this.#attach(api);
      return api;
    });
    // YTM adds the <video> a little after its player API.
    this.#videoReady = this.#ready.then((api) => waitForSelector<HTMLVideoElement>(selectors["player.video"], { root: api }));
  }

  get api() {
    return this.#api;
  }

  get state(): NowPlaying {
    return this.#state;
  }

  ready() {
    return this.#ready;
  }

  videoReady() {
    return this.#videoReady;
  }

  video() {
    return this.#api?.querySelector("video") ?? document.querySelector<HTMLVideoElement>(selectors["player.video"]);
  }

  on<K extends keyof PlayerEvents>(event: K, listener: PlayerEvents[K]): Unsubscribe {
    return this.#emitter.on(event, listener);
  }

  control(action: PlayerAction) {
    const api = this.#api;
    if (!api) return;
    switch (action.type) {
      case "play":
        return api.playVideo();
      case "pause":
        return api.pauseVideo();
      case "toggle":
        return isPlaying(this.#state) ? api.pauseVideo() : api.playVideo();
      case "next":
        return clickOr("player_bar.next", () => api.nextVideo());
      case "previous":
        return clickOr("player_bar.previous", () => api.previousVideo());
      case "seek":
        return api.seekTo(Math.max(0, action.seconds), true);
      case "seekBy":
        return api.seekTo(Math.max(0, api.getCurrentTime() + action.seconds), true);
      case "volume":
        return this.#setVolume(api, Math.round(clamp(action.value, 0, 100)));
      case "mute":
        return (action.muted ?? !api.isMuted()) ? api.mute() : api.unMute();
      case "like":
        return clickOr("player_bar.like");
      case "dislike":
        return clickOr("player_bar.dislike");
      case "shuffle":
        return clickOr("player_bar.shuffle");
      case "repeat":
        return clickOr("player_bar.repeat");
    }
  }

  #setVolume(api: YTPlayerApi, volume: number) {
    // YTM's slider value is what users see; updateVolume applies YTM's
    // perceptual curve to the actual audio (e.g. 37 → 12%) and persists it.
    const bar = document.querySelector<PlayerBarElement>(selectors.player_bar);
    if (bar?.updateVolume) bar.updateVolume(volume);
    else api.setVolume(volume);
  }

  /** New appearance options; re-reads the current track, whose artist they can change. */
  setOptions(options: Record<string, unknown>) {
    this.#options = options;
    this.#refreshTrack();
  }

  #refreshTrack() {
    const api = this.#api;
    const current = this.#state.track;
    if (!api || !current) return;
    const track = this.#readTrack(api);
    if (track?.videoId === current.videoId && track.artist !== current.artist) this.#publishNow({ track });
  }

  async #findApi(): Promise<YTPlayerApi> {
    const element = await waitForSelector<YTPlayerApi>(selectors["player.api"]);
    while (typeof element.getPlayerState !== "function") await sleep(API_POLL_MS);
    return element;
  }

  #attach(api: YTPlayerApi) {
    let pendingVideoId: string | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const loadTrack = () => {
      pendingVideoId = undefined;
      clearTimeout(fallback);
      const track = this.#readTrack(api);
      if (!track) return;
      const previous = this.#state;
      // Ads reload the content video; only a different track (or a replay) is a change.
      const isNew = previous.track?.videoId !== track.videoId || previous.status === "ended";
      this.#publishNow(isNew ? { track, positionSeconds: 0 } : { track });
      if (isNew) this.#emitter.emit("trackChange", track);
    };
    api.addEventListener("videodatachange", (name: string, data?: { videoId?: string }) => {
      // Ads fire their own "dataloaded" with the ad's video id.
      const contentId = api.getVideoData().video_id;
      if (data?.videoId && data.videoId !== contentId) return;
      if (name === "dataloaded") {
        pendingVideoId = contentId;
        this.#emitter.emit("trackLoading", pendingVideoId);
        clearTimeout(fallback);
        fallback = setTimeout(loadTrack, DATAUPDATED_FALLBACK_MS);
      } else if (name === "dataupdated" && pendingVideoId !== undefined) {
        loadTrack();
      }
    });

    void this.#videoReady.then((video) => {
      this.#attachVideo(video);
      // A track already loaded before the player was found.
      if (!Number.isNaN(video.duration)) loadTrack();
    });

    this.#observeControls();
    this.#observeAds(api);
    this.#publishNow({ volume: this.#readVolume(), muted: api.isMuted() });
  }

  #attachVideo(video: HTMLVideoElement) {
    const status = (next: PlaybackStatus) => () => {
      if (this.#state.status === next) return;
      // During ads the video's position is the ad's.
      this.#publishNow(this.#state.ad ? { status: next } : { status: next, positionSeconds: video.currentTime });
      this.#emitter.emit("statusChange", next);
    };
    video.addEventListener("playing", status("playing"));
    video.addEventListener("pause", status("paused"));
    video.addEventListener("waiting", status("buffering"));
    video.addEventListener("ended", status("ended"));
    video.addEventListener("seeked", () => {
      if (!this.#state.ad) this.#publishNow({ positionSeconds: video.currentTime });
    });
    let lastSecond = -1;
    video.addEventListener("timeupdate", () => {
      if (this.#state.ad) return;
      const second = Math.floor(video.currentTime);
      if (second === lastSecond) return;
      lastSecond = second;
      this.#publishLater({ positionSeconds: video.currentTime });
      this.#emitter.emit("timeUpdate", video.currentTime);
    });
    video.addEventListener("volumechange", () => {
      const volume = this.#readVolume();
      const muted = this.#api?.isMuted() ?? video.muted;
      this.#publishNow({ volume, muted });
      this.#emitter.emit("volumeChange", volume, muted);
    });
    if (!video.paused) status("playing")();
  }

  /** The volume as YTM's slider shows it (before its perceptual curve). */
  #readVolume() {
    const slider = document.querySelector<HTMLElement & { value?: number }>(selectors["player_bar.volume_slider"]);
    if (typeof slider?.value === "number") return Math.round(slider.value);
    return this.#api?.getVolume() ?? 100;
  }

  /** YTM plays ads in the same <video>; the player gets an `ad-showing` class meanwhile. */
  #observeAds(api: YTPlayerApi) {
    const read = () => {
      const ad = api.classList.contains("ad-showing") || api.classList.contains("ad-interrupting");
      if (ad === this.#state.ad) return;
      this.#publishNow({ ad });
      this.#emitter.emit("adChange", ad);
    };
    new MutationObserver(read).observe(api, { attributes: true, attributeFilter: ["class"] });
    read();
  }

  #observeControls() {
    const read = () => {
      const bar = document.querySelector<PlayerBarElement>(selectors.player_bar);
      const repeat = REPEAT_MODES[bar?.getState?.().queue?.repeatMode ?? ""] ?? this.#state.repeat;
      const shuffle = bar?.hasAttribute("shuffle-on") ?? false;
      const likeStatus = document.querySelector(selectors["player_bar.like_buttons"])?.getAttribute("like-status");
      const like = LIKE_STATUS[likeStatus ?? ""] ?? "none";
      const s = this.#state;
      if (repeat !== s.repeat || shuffle !== s.shuffle || like !== s.like) this.#publishNow({ repeat, shuffle, like });
    };
    void waitForSelector(selectors.player_bar).then((bar) => {
      new MutationObserver(read).observe(bar, {
        attributes: true,
        subtree: true,
        attributeFilter: ["shuffle-on", "like-status", "title", "aria-label", "repeat-mode"],
      });
      read();
    });
  }

  #readTrack(api: YTPlayerApi): Track | undefined {
    const response = api.getPlayerResponse();
    const details = response?.videoDetails;
    const data = api.getVideoData();
    const videoId = details?.videoId ?? data.video_id;
    if (!videoId) return;
    const title = details?.title ?? data.title;
    const session = mediaSessionFor(title);
    const mediaType = MEDIA_TYPES[details?.musicVideoType ?? ""] ?? "other";
    const track: Track = {
      videoId,
      title,
      artist: this.#artist(mediaType, session?.artist || details?.author || data.author, response),
      durationSeconds: Number(details?.lengthSeconds) || api.getDuration() || 0,
      url: ytmUrl(`/watch?v=${videoId}`),
      mediaType,
    };
    const artworkUrl = sessionArtwork(session) ?? largestThumbnail(response);
    if (session?.album) track.album = session.album;
    if (artworkUrl) track.artworkUrl = artworkUrl;
    if (data.list) track.playlistId = data.list;
    return track;
  }

  /**
   * Episodes name the show as their author; like pear-desktop, their artist is the
   * channel owner (usually the host, a person) unless the option asks for the listed participant.
   */
  #artist(mediaType: MediaType, listed: string, response: YTPlayerResponse | undefined) {
    const host = response?.microformat?.microformatDataRenderer?.pageOwnerDetails?.name;
    if (mediaType !== "podcast" || !host) return listed;
    return this.#options.usePodcastParticipantAsArtist === true ? listed : host;
  }

  #publishNow(patch: Partial<NowPlaying>) {
    this.#publisher.now(this.#apply(patch));
  }

  /** For position-only updates, which the host gets batched. */
  #publishLater(patch: Partial<NowPlaying>) {
    this.#publisher.batched(this.#apply(patch));
  }

  #apply(patch: Partial<NowPlaying>) {
    this.#state = { ...this.#state, ...patch, updatedAt: Date.now() };
    this.#emitter.emit("change", this.#state);
    return this.#state;
  }
}

/** Clicks the player bar's own button, so YTM does what it does on a click; `fallback` while it isn't there. */
function clickOr(name: SelectorName, fallback?: () => void) {
  const button = document.querySelector<HTMLElement>(selectors[name]);
  if (button) button.click();
  else fallback?.();
}

/** The media session's metadata if it already describes this track: it has the album and the largest artwork. */
function mediaSessionFor(title: string) {
  const metadata = navigator.mediaSession?.metadata;
  return metadata?.title === title ? metadata : undefined;
}

function sessionArtwork(metadata: MediaMetadata | undefined) {
  return largest(metadata?.artwork.map((a) => ({ url: a.src, size: parseSize(a.sizes) })) ?? []);
}

function largestThumbnail(response: YTPlayerResponse | undefined) {
  const thumbnails = response?.videoDetails?.thumbnail?.thumbnails ?? [];
  return largest(thumbnails.map((t) => ({ url: t.url, size: t.width * t.height })));
}

function parseSize(sizes: string | undefined) {
  const [w = 0, h = 0] = (sizes ?? "").split("x").map(Number);
  return w * h;
}

function largest(items: { url: string; size: number }[]) {
  return items.reduce<{ url: string; size: number } | undefined>(
    (best, item) => (!best || item.size > best.size ? item : best),
    undefined,
  )?.url;
}
