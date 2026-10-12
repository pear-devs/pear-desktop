/**
 * Single-writer arbitration for HTMLMediaElement.playbackRate.
 *
 * Two plugins can control the playback rate (playback-speed and
 * slowed-reverb). If both force their value on every ratechange they
 * overwrite each other forever, queueing one ratechange per write. Each
 * plugin claims ownership before it writes, skips its forcing handlers while
 * another plugin owns the rate, and claims back whenever the user explicitly
 * interacts with its own control: the last explicit action wins, and the
 * other plugin yields instead of fighting.
 *
 * Renderer-only module shared by the plugins that control the rate.
 */
let owner: string | null = null;

export function claimPlaybackRate(id: string): void {
  owner = id;
}

export function releasePlaybackRate(id: string): void {
  if (owner === id) {
    owner = null;
  }
}

export function getPlaybackRateOwner(): string | null {
  return owner;
}

/** True while no plugin owns the rate, or `id` itself does. */
export function isPlaybackRateOwner(id: string): boolean {
  return owner === null || owner === id;
}

/** True while a different plugin owns the rate. */
export function isPlaybackRateControlledByOther(id: string): boolean {
  return owner !== null && owner !== id;
}
