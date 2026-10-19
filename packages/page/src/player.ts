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
} from "@pear/sdk";
import { selectors } from "@pear/sdk/selectors";
import { waitForSelector } from "./dom.ts";
import { Emitter } from "./emitter.ts";

type Events = {
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

const MEDIA_TYPES: Record<string, MediaType> = {
  MUSIC_VIDEO_TYPE_ATV: "audio",
  MUSIC_VIDEO_TYPE_OMV: "video",
  MUSIC_VIDEO_TYPE_UGC: "video",
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: "podcast",
};

const REPEAT_MODES: Record<string, RepeatMode> = { NONE: "none", ALL: "all", ONE: "one" };

interface PlayerBarElement extends HTMLElement {
  getState?(): { queue?: { repeatMode?: string } };
  updateVolume?(volume: number): void;
}

export class Player implements PagePlayer {
  #emitter = new Emitter<Events>();
  #api: YTPlayerApi | null = null;
  #ready: Promise<YTPlayerApi>;
  #state: NowPlaying = { ...IDLE };
  #publish: (state: NowPlaying, urgent: boolean) => void;

  constructor(publish: (state: NowPlaying, urgent: boolean) => void) {
    this.#publish = publish;
    this.#ready = this.#findApi().then((api) => {
      this.#api = api;
      this.#attach(api);
      return api;
    });
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

  video() {
    return this.#api?.querySelector("video") ?? document.querySelector<HTMLVideoElement>(selectors["player.video"]);
  }

  on<K extends keyof Events>(event: K, listener: Events[K]): Unsubscribe {
    return this.#emitter.on(event, listener);
  }

  control(action: PlayerAction) {
    const api = this.#api;
    if (!api) return;
    const click = (name: keyof typeof selectors) => document.querySelector<HTMLElement>(selectors[name])?.click();
    switch (action.type) {
      case "play":
        return api.playVideo();
      case "pause":
        return api.pauseVideo();
      case "toggle":
        return this.#state.status === "playing" ? api.pauseVideo() : api.playVideo();
      case "next":
        return document.querySelector(selectors["player_bar.next"]) ? click("player_bar.next") : api.nextVideo();
      case "previous":
        return document.querySelector(selectors["player_bar.previous"])
          ? click("player_bar.previous")
          : api.previousVideo();
      case "seek":
        return api.seekTo(Math.max(0, action.seconds), true);
      case "seekBy":
        return api.seekTo(Math.max(0, api.getCurrentTime() + action.seconds), true);
      case "volume": {
        const volume = Math.round(Math.min(100, Math.max(0, action.value)));
        // YTM's slider value is what users see; updateVolume applies YTM's
        // perceptual curve to the actual audio (e.g. 37 → 12%) and persists it.
        const bar = document.querySelector<PlayerBarElement>(selectors.player_bar);
        if (bar?.updateVolume) bar.updateVolume(volume);
        else api.setVolume(volume);
        return;
      }
      case "mute":
        return (action.muted ?? !api.isMuted()) ? api.mute() : api.unMute();
      case "like":
        return click("player_bar.like");
      case "dislike":
        return click("player_bar.dislike");
      case "shuffle":
        return click("player_bar.shuffle");
      case "repeat":
        return click("player_bar.repeat");
    }
  }

  async #findApi(): Promise<YTPlayerApi> {
    const element = await waitForSelector<YTPlayerApi>(selectors["player.api"]);
    // The element exists before YTM upgrades it with the API methods.
    while (typeof element.getPlayerState !== "function") {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
      this.#update(isNew ? { track, positionSeconds: 0 } : { track }, true);
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

    const video = this.video();
    if (video) this.#attachVideo(video);
    if (video && !Number.isNaN(video.duration)) loadTrack();

    this.#observeControls();
    this.#observeAds(api);
    this.#update({ volume: this.#readVolume(), muted: api.isMuted() }, true);
  }

  #attachVideo(video: HTMLVideoElement) {
    const status = (next: PlaybackStatus) => () => {
      if (this.#state.status === next) return;
      this.#update(this.#state.ad ? { status: next } : { status: next, positionSeconds: video.currentTime }, true);
      this.#emitter.emit("statusChange", next);
    };
    video.addEventListener("playing", status("playing"));
    video.addEventListener("pause", status("paused"));
    video.addEventListener("waiting", status("buffering"));
    video.addEventListener("ended", status("ended"));
    video.addEventListener("seeked", () => {
      if (!this.#state.ad) this.#update({ positionSeconds: video.currentTime }, true);
    });
    let lastSecond = -1;
    video.addEventListener("timeupdate", () => {
      if (this.#state.ad) return;
      const second = Math.floor(video.currentTime);
      if (second === lastSecond) return;
      lastSecond = second;
      this.#update({ positionSeconds: video.currentTime }, false);
      this.#emitter.emit("timeUpdate", video.currentTime);
    });
    video.addEventListener("volumechange", () => {
      const volume = this.#readVolume();
      const muted = this.#api?.isMuted() ?? video.muted;
      this.#update({ volume, muted }, true);
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
      this.#update({ ad }, true);
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
      const like: LikeStatus = likeStatus === "LIKE" ? "like" : likeStatus === "DISLIKE" ? "dislike" : "none";
      const s = this.#state;
      if (repeat !== s.repeat || shuffle !== s.shuffle || like !== s.like) this.#update({ repeat, shuffle, like }, true);
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
    const metadata = navigator.mediaSession?.metadata;
    const sameTrack = metadata && metadata.title === (details?.title ?? data.title);
    const artwork = sameTrack ? largest(metadata.artwork.map((a) => ({ url: a.src, size: parseSize(a.sizes) }))) : undefined;
    const thumbnails = details?.thumbnail?.thumbnails ?? [];
    const thumbnail = largest(thumbnails.map((t) => ({ url: t.url, size: t.width * t.height })));
    const track: Track = {
      videoId,
      title: details?.title ?? data.title,
      artist: (sameTrack && metadata.artist) || details?.author || data.author,
      durationSeconds: Number(details?.lengthSeconds) || api.getDuration() || 0,
      url: `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${videoId}`,
      mediaType: MEDIA_TYPES[details?.musicVideoType ?? ""] ?? "other",
    };
    if (sameTrack && metadata.album) track.album = metadata.album;
    const artworkUrl = artwork ?? thumbnail;
    if (artworkUrl) track.artworkUrl = artworkUrl;
    if (data.list) track.playlistId = data.list;
    return track;
  }

  #update(patch: Partial<NowPlaying>, urgent: boolean) {
    this.#state = { ...this.#state, ...patch, updatedAt: Date.now() };
    this.#emitter.emit("change", this.#state);
    this.#publish(this.#state, urgent);
  }
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
