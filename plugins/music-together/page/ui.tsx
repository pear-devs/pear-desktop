import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatCode, HOST_ID, parseVideoId, PERMISSIONS, type Participant, type QueueItem } from "../protocol.ts";
import type { GuestSession, HostSession } from "../session.ts";
import type { Together } from "./controller.ts";

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
      <button type="button" class="close" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

function Start({ together, message }: { together: Together; message: string | undefined }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(together.name);
  return (
    <>
      <header class="intro">
        <span class="badge-icon" aria-hidden="true">
          <PeopleIcon />
        </span>
        <div>
          <h2>Music Together</h2>
          <p>Listen in sync with friends. Everyone hears what the host plays.</p>
        </div>
      </header>
      <label class="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={32}
          onInput={(e) => setName(e.currentTarget.value)}
          onChange={(e) => together.setName(e.currentTarget.value.trim())}
        />
      </label>
      <button type="button" class="button primary wide" onClick={() => void together.host()}>
        Start a session
      </button>
      <div class="divider">
        <span>or join one</span>
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
          aria-label="Session code"
          value={code}
          maxLength={9}
          spellcheck={false}
          autocomplete="off"
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
        />
        <button type="submit" class="button" disabled={code.replace(/[^a-z0-9]/gi, "").length < 6}>
          Join
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
  return (
    <>
      <header class="status">
        <span class="live">
          <i aria-hidden="true" /> Hosting
        </span>
        <button type="button" class="button danger small" onClick={() => together.stop()}>
          End session
        </button>
      </header>
      <div class="code-card">
        <span class="label">Session code</span>
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
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span class="hint">Friends join with this code from their Pear Desktop.</span>
      </div>
      <section>
        <h3>Guests can</h3>
        <div class="segmented" role="radiogroup" aria-label="Guest permissions">
          {PERMISSIONS.map((p) => (
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
        <p class="hint">{PERMISSIONS.find((p) => p.value === session.permission)?.description}.</p>
      </section>
      <People participants={session.participants} you={HOST_ID} />
      <Queue
        items={session.queue}
        participants={session.participants}
        canManage={() => true}
        onPlay={(id) => session.playItem(id)}
        onRemove={(id) => session.removeItem(id)}
        empty="Songs you or your guests add play next."
      />
      <AddSong onAdd={(videoId) => void session.suggest(videoId)} label="Add to queue" />
    </>
  );
}

function Joined({ together, session, code }: { together: Together; session: GuestSession; code: string }) {
  const room = session.room;
  const connected = session.status === "connected";
  const permission = session.permission;
  return (
    <>
      <header class="status">
        <span class="live guest">
          <i aria-hidden="true" />
          {connected ? `With ${session.hostName}` : "Connecting…"}
        </span>
        <button type="button" class="button small" onClick={() => together.stop()}>
          Leave
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
            {session.inSync ? "In sync" : "Syncing…"}
          </span>
        </div>
      )}
      <p class="hint">
        Session {formatCode(code)} · {PERMISSIONS.find((p) => p.value === permission)?.description}
      </p>
      {room && <People participants={room.participants} you={session.you} />}
      {room && (
        <Queue
          items={room.queue}
          participants={room.participants}
          canManage={(item) => permission === "control" || item.by === session.you}
          canPlay={permission === "control"}
          onPlay={(id) => session.control({ type: "playItem", id })}
          onRemove={(id) => session.control({ type: "removeItem", id })}
          empty={permission === "host-only" ? "The host picks the music." : "Suggest a song and it plays next."}
        />
      )}
      {permission !== "host-only" && <AddSong onAdd={(videoId) => session.suggest(videoId)} label="Suggest" />}
    </>
  );
}

function People({ participants, you }: { participants: Participant[]; you: string }) {
  return (
    <section>
      <h3>
        Listening <span class="muted">{participants.length}</span>
      </h3>
      <ul class="people">
        {participants.map((p) => (
          <li key={p.id}>
            <Avatar name={p.name} />
            <span class="name">{p.name}</span>
            {p.id === you && <span class="tag">you</span>}
            {p.id === HOST_ID && <span class="tag host">host</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface QueueProps {
  items: QueueItem[];
  participants: Participant[];
  canManage(item: QueueItem): boolean;
  canPlay?: boolean;
  onPlay(id: string): void;
  onRemove(id: string): void;
  empty: string;
}

function Queue({ items, participants, canManage, canPlay = true, onPlay, onRemove, empty }: QueueProps) {
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? "someone";
  return (
    <section>
      <h3>
        Up next <span class="muted">{items.length || ""}</span>
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
                  {item.artist ? `${item.artist} · ` : ""}added by {nameOf(item.by)}
                </span>
              </div>
              {canManage(item) && (
                <div class="actions">
                  {canPlay && (
                    <button type="button" class="icon" aria-label={`Play ${item.title} now`} title="Play now" onClick={() => onPlay(item.id)}>
                      <PlayIcon />
                    </button>
                  )}
                  <button type="button" class="icon" aria-label={`Remove ${item.title}`} title="Remove" onClick={() => onRemove(item.id)}>
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

function AddSong({ onAdd, label }: { onAdd(videoId: string): void; label: string }) {
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
        placeholder={"Paste a \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music link"}
        aria-label="Song link"
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
