/** @jsxImportSource @pear/sdk */
// Who added each queue item, as pear-desktop showed it.

import { getDefaultProfile, type Profile } from "./types.ts";

/** Adds (or updates) the owner's avatar and name on a queue row. */
export function decorateOwner(item: HTMLElement, index: number, id: string, profile: Profile | undefined, unknownName: string) {
  const avatar = item.querySelector<HTMLImageElement>(".music-together-owner") ?? ((<img class="music-together-owner" />) as HTMLImageElement);
  avatar.dataset.id = id;
  avatar.dataset.index = String(index);
  const name = item.querySelector<HTMLElement>(".music-together-name") ?? <div class="music-together-name" />;
  name.textContent = profile?.name ?? unknownName;
  // A guest who never identified gets a generated avatar.
  const shown = profile?.name || profile?.handleId ? profile : getDefaultProfile(profile?.id ?? "");
  avatar.src = shown.thumbnail;
  avatar.title = shown.name;
  avatar.alt = shown.handleId;
  if (!avatar.isConnected) item.append(avatar);
  if (!name.isConnected) item.append(name);
}
