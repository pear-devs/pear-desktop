import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Translate } from "@pear/sdk/i18n";
import { formatCode, HOST_ID, parseVideoId, PERMISSIONS, type Participant, type QueueItem } from "../protocol.ts";
import type { GuestSession, HostSession } from "../session.ts";
import type { Together } from "./controller.ts";

/** The guest permissions in the UI's language (labels shared with the settings field's options). */
function permissionTexts(t: Translate) {
  const texts = {
    "host-only": [
      t("plugins.music-together.settings.defaultPermission.options.host-only", "Listen only"),
      t("plugins.music-together.ui.permission.host-only", "Only you control the music"),
    ],
    suggest: [t("plugins.music-together.ui.permission-label.suggest", "Suggest"), t("plugins.music-together.ui.permission.suggest", "Guests can add songs to the queue")],
    control: [
      t("plugins.music-together.settings.defaultPermission.options.control", "Full control"),
      t("plugins.music-together.ui.permission.control", "Guests can also play, pause, seek and skip"),
    ],
  };
  return PERMISSIONS.map((p) => ({ ...p, label: texts[p.value][0]!, description: texts[p.value][1]! }));
}

function useTogether(together: Together) {
  const [, setTick] = useState(0);
  useEffect(() => together.subscribe(() => setTick((t) => t + 1)), [together]);
  // Sync status ("in sync" / "syncing") changes without session events.
  useEffect(() => {
    const timer = setInterval(() => together.mode.kind === "guest" && setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [together]);
}

export function LauncherButton({ together, open, onClick }: { together: Together; open: boolean; onClick(): void }) {
  useTogether(together);
  const mode = together.mode;
  const count =
    mode.kind === "host" ? mode.session.participants.length : mode.kind === "guest" ? (mode.session.room?.participants.length ?? 0) : 0;
  const active = mode.kind === "host" || mode.kind === "guest";
  return (
    <button
      type="button"
      class="launcher"
      data-active={active}
      aria-expanded={open}
      aria-label="Music Together"
      title="Music Together"
      onClick={onClick}
    >
      <PeopleIcon />
      {active && count > 1 && <span class="count">{count}</span>}
    </button>
  );
}

export function Panel({ together, onClose }: { together: Together; onClose(): void }) {
  useTogether(together);
  const { t } = together;
  const mode = together.mode;
  return (
    <div class="panel" role="dialog" aria-label="Music Together">
      {mode.kind === "idle" && <Start together={together} message={mode.message} />}
      {mode.kind === "busy" && (
        <div class="busy" role="status">
          <span class="spinner" aria-hidden="true" />
          {mode.label}
        </div>
      )}
      {mode.kind === "host" && <Hosting together={together} session={mode.session} code={mode.code} />}
      {mode.kind === "guest" && <Joined together={together} session={mode.session} code={mode.code} />}
      <button type="button" class="close" aria-label={t("plugins.music-together.ui.close", "Close")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

function Start({ together, message }: { together: Together; message: string | undefined }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(together.name);
  const { t } = together;
  return (
    <>
      <header class="intro">
        <span class="badge-icon" aria-hidden="true">
          <PeopleIcon />
        </span>
        <div>
          <h2>Music Together</h2>
          <p>{t("plugins.music-together.ui.intro", "Listen in sync with friends. Everyone hears what the host plays.")}</p>
        </div>
      </header>
      <label class="field">
        <span>{t("plugins.music-together.settings.displayName.label", "Your name")}</span>
        <input
          value={name}
          maxLength={32}
          onInput={(e) => setName(e.currentTarget.value)}
          onChange={(e) => together.setName(e.currentTarget.value.trim())}
        />
      </label>
      <button type="button" class="button primary wide" onClick={() => void together.host()}>
        {t("plugins.music-together.ui.start", "Start a session")}
      </button>
      <div class="divider">
        <span>{t("plugins.music-together.ui.or-join", "or join one")}</span>
      </div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void together.join(code);
        }}
      >
        <input
          class="code-input"
          placeholder="ABC-123"
          aria-label={t("plugins.music-together.ui.session-code", "Session code")}
          value={code}
          maxLength={9}
          spellcheck={false}
          autocomplete="off"
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
        />
        <button type="submit" class="button" disabled={code.replace(/[^a-z0-9]/gi, "").length < 6}>
          {t("plugins.music-together.ui.join", "Join")}
        </button>
      </form>
      {message && (
        <p class="message" role="alert">
          {message}
        </p>
      )}
    </>
  );
}

function Hosting({ together, session, code }: { together: Together; session: HostSession; code: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = together;
  const permissions = permissionTexts(t);
  return (
    <>
      <header class="status">
        <span class="live">
          <i aria-hidden="true" /> {t("plugins.music-together.ui.hosting", "Hosting")}
        </span>
        <button type="button" class="button danger small" onClick={() => together.stop()}>
          {t("plugins.music-together.ui.end", "End session")}
        </button>
      </header>
      <div class="code-card">
        <span class="label">{t("plugins.music-together.ui.session-code", "Session code")}</span>
        <div class="code-row">
          <code data-code={code}>{formatCode(code)}</code>
          <button
            type="button"
            class="button small"
            onClick={() => {
              together.copy(formatCode(code));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? t("plugins.music-together.ui.copied", "Copied") : t("plugins.music-together.ui.copy", "Copy")}
          </button>
        </div>
        <span class="hint">{t("plugins.music-together.ui.code-hint", "Friends join with this code from their Pear Desktop.")}</span>
      </div>
      <section>
        <h3>{t("plugins.music-together.ui.guests-can", "Guests can")}</h3>
        <div class="segmented" role="radiogroup" aria-label={t("plugins.music-together.ui.guest-permissions", "Guest permissions")}>
          {permissions.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={session.permission === p.value}
              title={p.description}
              onClick={() => session.setPermission(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p class="hint">{permissions.find((p) => p.value === session.permission)?.description}.</p>
      </section>
      <People t={t} participants={session.participants} you={HOST_ID} />
      <Queue
        t={t}
        items={session.queue}
        participants={session.participants}
        canManage={() => true}
        onPlay={(id) => session.playItem(id)}
        onRemove={(id) => session.removeItem(id)}
        empty={t("plugins.music-together.ui.queue-empty-host", "Songs you or your guests add play next.")}
      />
      <AddSong t={t} onAdd={(videoId) => void session.suggest(videoId)} label={t("plugins.music-together.ui.add", "Add to queue")} />
    </>
  );
}

function Joined({ together, session, code }: { together: Together; session: GuestSession; code: string }) {
  const room = session.room;
  const connected = session.status === "connected";
  const permission = session.permission;
  const { t } = together;
  return (
    <>
      <header class="status">
        <span class="live guest">
          <i aria-hidden="true" />
          {connected
            ? t("plugins.music-together.ui.with-host", "With {{name}}", { name: session.hostName })
            : t("plugins.music-together.ui.connecting", "Connecting…")}
        </span>
        <button type="button" class="button small" onClick={() => together.stop()}>
          {t("plugins.music-together.ui.leave", "Leave")}
        </button>
      </header>
      {session.playback && (
        <div class="now">
          {session.playback.artworkUrl && <img src={session.playback.artworkUrl} alt="" />}
          <div>
            <strong>{session.playback.title}</strong>
            <span>{session.playback.artist}</span>
          </div>
          <span class="sync" data-sync={session.inSync}>
            {session.inSync ? t("plugins.music-together.ui.in-sync", "In sync") : t("plugins.music-together.ui.syncing", "Syncing…")}
          </span>
        </div>
      )}
      <p class="hint">
        {t("plugins.music-together.ui.session", "Session {{code}}", { code: formatCode(code) })} ·{" "}
        {permissionTexts(t).find((p) => p.value === permission)?.description}
      </p>
      {room && <People t={t} participants={room.participants} you={session.you} />}
      {room && (
        <Queue
          t={t}
          items={room.queue}
          participants={room.participants}
          canManage={(item) => permission === "control" || item.by === session.you}
          canPlay={permission === "control"}
          onPlay={(id) => session.control({ type: "playItem", id })}
          onRemove={(id) => session.control({ type: "removeItem", id })}
          empty={
            permission === "host-only"
              ? t("plugins.music-together.ui.queue-empty-listen", "The host picks the music.")
              : t("plugins.music-together.ui.queue-empty-guest", "Suggest a song and it plays next.")
          }
        />
      )}
      {permission !== "host-only" && (
        <AddSong t={t} onAdd={(videoId) => session.suggest(videoId)} label={t("plugins.music-together.ui.suggest", "Suggest")} />
      )}
    </>
  );
}

function People({ t, participants, you }: { t: Translate; participants: Participant[]; you: string }) {
  return (
    <section>
      <h3>
        {t("plugins.music-together.ui.listening", "Listening")} <span class="muted">{participants.length}</span>
      </h3>
      <ul class="people">
        {participants.map((p) => (
          <li key={p.id}>
            <Avatar name={p.name} />
            <span class="name">{p.name}</span>
            {p.id === you && <span class="tag">{t("plugins.music-together.ui.you", "you")}</span>}
            {p.id === HOST_ID && <span class="tag host">{t("plugins.music-together.ui.host", "host")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface QueueProps {
  t: Translate;
  items: QueueItem[];
  participants: Participant[];
  canManage(item: QueueItem): boolean;
  canPlay?: boolean;
  onPlay(id: string): void;
  onRemove(id: string): void;
  empty: string;
}

function Queue({ t, items, participants, canManage, canPlay = true, onPlay, onRemove, empty }: QueueProps) {
  const nameOf = (id: string) =>
    participants.find((p) => p.id === id)?.name ?? t("plugins.music-together.internal.unknown-user", "Unknown User");
  return (
    <section>
      <h3>
        {t("plugins.music-together.ui.up-next", "Up next")} <span class="muted">{items.length || ""}</span>
      </h3>
      {items.length === 0 ? (
        <p class="hint">{empty}</p>
      ) : (
        <ol class="queue">
          {items.map((item) => (
            <li key={item.id} data-video={item.videoId}>
              <img src={`https://i.ytimg.com/vi/${item.videoId}/default.jpg`} alt="" loading="lazy" />
              <div class="meta">
                <strong title={item.title}>{item.title}</strong>
                <span>
                  {item.artist ? `${item.artist} · ` : ""}
                  {t("plugins.music-together.ui.added-by", "added by {{name}}", { name: nameOf(item.by) })}
                </span>
              </div>
              {canManage(item) && (
                <div class="actions">
                  {canPlay && (
                    <button type="button" class="icon" aria-label={t("plugins.music-together.ui.play-item", "Play {{title}} now", { title: item.title })}
                      title={t("plugins.music-together.ui.play-now", "Play now")} onClick={() => onPlay(item.id)}>
                      <PlayIcon />
                    </button>
                  )}
                  <button type="button" class="icon" aria-label={t("plugins.music-together.ui.remove-item", "Remove {{title}}", { title: item.title })}
                    title={t("plugins.music-together.ui.remove", "Remove")} onClick={() => onRemove(item.id)}>
                    <CloseIcon />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddSong({ t, onAdd, label }: { t: Translate; onAdd(videoId: string): void; label: string }) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      class="row add"
      onSubmit={(e) => {
        e.preventDefault();
        const videoId = parseVideoId(value);
        if (!videoId) return setInvalid(true);
        onAdd(videoId);
        setValue("");
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        placeholder={t("plugins.music-together.ui.link-placeholder", "Paste a \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music link")}
        aria-label={t("plugins.music-together.ui.song-link", "Song link")}
        aria-invalid={invalid}
        value={value}
        onInput={(e) => {
          setValue(e.currentTarget.value);
          setInvalid(false);
        }}
      />
      <button type="submit" class="button" disabled={!value.trim()}>
        {label}
      </button>
    </form>
  );
}

export function Toasts({ items }: { items: { id: number; text: string }[] }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span class="avatar" style={{ background: `hsl(${Math.abs(hash) % 360} 45% 38%)` }} aria-hidden="true">
      {initials}
    </span>
  );
}

const Svg = ({ children }: { children: ComponentChildren }) => (
  <svg viewBox="0 -960 960 960" width="24" height="24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);

// Material Symbols "groups", as upstream.
const PeopleIcon = () => (
  <Svg>
    <path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z" />
  </Svg>
);

const CloseIcon = () => (
  <Svg>
    <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
  </Svg>
);

const PlayIcon = () => (
  <Svg>
    <path d="M320-200v-560l440 280-440 280Z" />
  </Svg>
);
