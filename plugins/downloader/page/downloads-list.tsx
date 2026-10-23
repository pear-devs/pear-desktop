// What the Downloads popover and the Downloads page show. The popover sums up
// the download in front: a ring with how far it is, its songs done, what failed
// and what waits. The page's queue is a strip with the same, that opens to a row
// per song still to go and the finished downloads. Preact, rendered while they show.

import { useEffect, useState } from "preact/hooks";
import { remoteErrorMessage } from "@pear/sdk/util";
import type { Job } from "../jobs.ts";
import { formatBytes, formatSpeed, formatTimeLeft, formatWhen } from "./format.ts";
import type { Ctx } from "./types.ts";
import { finishedSize, type Row, type Summary, summarize } from "./views.ts";

// Material icons.
const ICONS = {
  song: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
  album: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  playlist: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 0 0 16 14a3 3 0 1 0 3 3V8h3V6h-5z",
  download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
  queued: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  failed: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  cancelled: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.31L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20z",
  done: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  resume: "M8 5v14l11-7z",
  cancel: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  remove: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  folder: "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
  export: "M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67 2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z",
  chevron: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
} as const;

const ROW_ICONS: Record<Row["status"], string> = {
  downloading: ICONS.download,
  converting: ICONS.song,
  queued: ICONS.queued,
  paused: ICONS.pause,
  failed: ICONS.failed,
  cancelled: ICONS.cancelled,
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** A circular progress indicator, 0–1. */
function Ring({ size, thickness, value }: { size: number; thickness: number; value: number }) {
  const radius = (size - thickness) / 2;
  const length = 2 * Math.PI * radius;
  const shown = Math.min(1, Math.max(0, value));
  return (
    <svg class="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle class="ring-track" cx={size / 2} cy={size / 2} r={radius} stroke-width={thickness} />
      {shown > 0 && (
        <circle
          class="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke-width={thickness}
          stroke-dasharray={`${shown * length} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}

/** The jobs, asked for when it shows and then as they change. */
function useJobs(ctx: Ctx) {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    const off = ctx.host.on("jobs", (payload) => setJobs(payload as Job[]));
    ctx.host.invoke("jobs").then(setJobs, () => {});
    return off;
  }, []);
  return jobs;
}

const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

/** How far the one in front is; all of it once all are done. */
const progressOf = ({ phase, current }: Summary) => (phase === "done" ? 1 : (current?.progress ?? 0));

/** "12 of 24" for an album or playlist whose songs are known; its title otherwise. */
function countOf({ t }: Ctx, { current, songsDone, songsTotal }: Summary) {
  if (!current) return "";
  if (current.kind === "song" || songsTotal === 0) return current.label;
  return t("plugins.downloader.queue.count", "{{done}} of {{total}}", { done: songsDone, total: songsTotal });
}

function phaseWord({ t }: Ctx, { phase, current }: Summary) {
  switch (phase) {
    case "running":
      return current?.status === "queued" ? t("plugins.downloader.queue.waiting", "Waiting") : t("plugins.downloader.queue.downloading", "Downloading");
    case "paused":
      return t("plugins.downloader.queue.paused", "Paused");
    case "stopped":
      return current?.status === "cancelled"
        ? t("plugins.downloader.queue.cancelled", "Download cancelled")
        : t("plugins.downloader.queue.failed", "Download failed");
    case "done":
      return t("plugins.downloader.queue.all-done", "All downloads finished");
    case "empty":
      return t("plugins.downloader.queue.empty", "Nothing downloaded yet");
  }
}

/** "3 failed", "2 more queued". */
function extras({ t }: Ctx, summary: Summary) {
  return {
    failed: summary.failed > 0 ? t("plugins.downloader.queue.failed-count", "{{count}} failed", { count: summary.failed }) : "",
    waiting: summary.waiting > 0 ? t("plugins.downloader.queue.waiting-count", "{{count}} more queued", { count: summary.waiting }) : "",
  };
}

/** The popover: the download in front, and a way to the Downloads page. */
export function DownloadsSummary({ ctx, onViewAll }: { ctx: Ctx; onViewAll(): void }) {
  const summary = summarize(useJobs(ctx));
  const { current, phase } = summary;
  const { failed, waiting } = extras(ctx, summary);
  const list = current && current.kind !== "song" && summary.songsTotal > 0;
  return (
    <div class="pear-dl-summary" data-phase={phase}>
      <div class="summary-main">
        {phase !== "empty" && (
          <div class="summary-ring">
            <Ring size={72} thickness={6} value={progressOf(summary)} />
            <span class="summary-percent">{percent(progressOf(summary))}</span>
          </div>
        )}
        <div class="summary-text">
          <div class="summary-phase">{phaseWord(ctx, summary)}</div>
          {current && (
            <div class="summary-count" title={current.label}>
              {countOf(ctx, summary)}
            </div>
          )}
          {list && (
            <div class="summary-name" title={current.label}>
              {current.label}
            </div>
          )}
        </div>
      </div>
      <div class="summary-footer">
        {failed && <span class="summary-failed">{failed}</span>}
        {waiting && <span class="summary-waiting">{waiting}</span>}
        <span class="spacer" />
        <button type="button" class="text-button" onClick={onViewAll}>
          {ctx.t("plugins.downloader.queue.view-all", "View all")}
        </button>
      </div>
    </div>
  );
}

/** Until when the page's strip stays away once everything is done: it was dismissed, or nothing finished since the app started. */
let dismissedAt = Date.now();
/** The last "View all" the strip followed, so that it follows each once. */
let revealed = 0;

/**
 * The Downloads page's queue: a strip that sums up the downloads and opens to
 * their rows. `reveal` changes when the popover's "View all" asks to see it open.
 */
export function Queue({ ctx, reveal }: { ctx: Ctx; reveal: number }) {
  const { t } = ctx;
  const jobs = useJobs(ctx);
  const [open, setOpen] = useState(reveal !== revealed);
  const [, setDismissed] = useState(dismissedAt);
  useEffect(() => {
    if (reveal === revealed) return;
    revealed = reveal;
    dismissedAt = 0;
    setDismissed(0);
    setOpen(true);
  }, [reveal]);

  const summary = summarize(jobs);
  const { phase, current } = summary;
  const lastFinished = Math.max(0, ...summary.finished.map((job) => job.finishedAt ?? 0));
  if (phase === "empty" || (phase === "done" && lastFinished <= dismissedAt)) return null;

  const allDone = phase === "done";
  const pausedAll = phase === "paused";
  const togglePause = (event: Event) => {
    event.stopPropagation();
    void ctx.host.invoke(pausedAll ? "resume" : "pause");
  };
  const dismiss = (event: Event) => {
    event.stopPropagation();
    dismissedAt = Date.now();
    setDismissed(dismissedAt);
    setOpen(false);
  };
  const { failed, waiting } = extras(ctx, summary);
  const pauseLabel = pausedAll ? t("plugins.downloader.queue.resume-all", "Resume all") : t("plugins.downloader.queue.pause-all", "Pause all");
  const canPause = phase === "running" || pausedAll;
  // Its songs show without a cancel of their own: the strip cancels all of it.
  const listInFront = current && summary.rows.some((row) => row.item) ? current : undefined;
  return (
    <section class="pear-dl-queue" data-phase={phase} aria-label={t("plugins.downloader.page.queue", "Download queue")}>
      <div class="strip" onClick={() => setOpen(!open)}>
        <Ring size={32} thickness={3} value={progressOf(summary)} />
        <div class="strip-text">
          <div class="strip-title">{stripTitle(ctx, summary)}</div>
          <div class="strip-sub">
            {[stripLine(ctx, summary), failed, waiting]
              .filter(Boolean)
              .map((part, index) => (
                <span class={part === failed ? "failed" : undefined}>
                  {index > 0 && <span class="dot">·</span>}
                  {part}
                </span>
              ))}
          </div>
        </div>
        {canPause && (
          <button type="button" class="icon-button" aria-label={pausedAll ? t("plugins.downloader.queue.resume", "Resume") : t("plugins.downloader.queue.pause", "Pause")} title={pauseLabel} onClick={togglePause}>
            <Icon path={pausedAll ? ICONS.resume : ICONS.pause} />
          </button>
        )}
        {listInFront && (
          <button
            type="button"
            class="icon-button"
            aria-label={t("plugins.downloader.queue.cancel", "Cancel")}
            title={t("plugins.downloader.queue.cancel-list", "Cancel “{{title}}”", { title: listInFront.label })}
            onClick={(event) => {
              event.stopPropagation();
              void ctx.host.invoke("cancel", listInFront.id);
            }}
          >
            <Icon path={ICONS.cancel} />
          </button>
        )}
        {allDone && (
          <button type="button" class="text-button" onClick={dismiss}>
            {t("plugins.downloader.queue.dismiss", "Dismiss")}
          </button>
        )}
        <button
          type="button"
          class="icon-button chevron"
          aria-expanded={open}
          aria-label={open ? t("plugins.downloader.queue.collapse", "Hide the downloads") : t("plugins.downloader.queue.expand", "Show the downloads")}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          <Icon path={ICONS.chevron} />
        </button>
      </div>
      {open && (
        <div class="strip-body">
          <ul class="rows">
            {summary.rows.map((row) => (
              <TrackRow key={row.key} ctx={ctx} row={row} inFront={row.job === current} />
            ))}
            {summary.finished.length > 0 && <Finished ctx={ctx} finished={summary.finished} />}
          </ul>
          <footer class="strip-footer">
            <button type="button" class="text-button" onClick={() => void ctx.host.invoke("openFolder")}>
              {t("plugins.downloader.queue.open-folder", "Open folder")}
            </button>
            <span class="legend" hidden={!summary.rows.some((row) => row.status === "downloading" || row.status === "converting")}>
              <span class="legend-item download">{t("plugins.downloader.queue.legend.download", "Download")}</span>
              <span class="legend-item convert">{t("plugins.downloader.queue.legend.convert", "Post-processing")}</span>
            </span>
            {summary.failed > 0 && (
              <button type="button" class="text-button" onClick={() => retryFailed(ctx, jobs)}>
                {t("plugins.downloader.queue.retry-failed", "Retry failed")}
              </button>
            )}
            {canPause && (
              <button type="button" class="text-button" onClick={togglePause}>
                {pauseLabel}
              </button>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}

function retryFailed(ctx: Ctx, jobs: readonly Job[]) {
  for (const job of jobs) if (job.status === "failed") void ctx.host.invoke("retry", job.id);
}

/** "Downloading Album · 12 of 24", "Paused · Song", "All downloads finished". */
function stripTitle(ctx: Ctx, summary: Summary) {
  const { phase, current, songsTotal } = summary;
  if (!current || phase === "done" || phase === "stopped") return phaseWord(ctx, summary);
  const running = phase === "running" && current.status !== "queued";
  const parts = running ? [ctx.t("plugins.downloader.queue.downloading-title", "Downloading {{title}}", { title: current.label })] : [phaseWord(ctx, summary), current.label];
  if (current.kind !== "song" && songsTotal > 0) parts.push(countOf(ctx, summary));
  return parts.join(" · ");
}

/** How the one in front goes: time left, converting, or how many songs were saved. */
function stripLine(ctx: Ctx, summary: Summary) {
  const { t } = ctx;
  const { phase, current } = summary;
  switch (phase) {
    case "paused":
      return t("plugins.downloader.queue.resume-hint", "Resume to continue");
    case "done": {
      const count = summary.finished.reduce((sum, job) => sum + songsSaved(job), 0);
      return count === 1
        ? t("plugins.downloader.queue.saved-one", "1 song saved")
        : t("plugins.downloader.queue.saved-many", "{{count}} songs saved", { count });
    }
    case "stopped":
      return "";
    default:
      if (!current || current.status === "queued") return t("plugins.downloader.queue.starting", "Starting");
      if (current.stage === "converting") return t("plugins.downloader.queue.converting", "Converting");
      if (current.eta !== undefined) return t("plugins.downloader.queue.left", "{{time}} left", { time: formatTimeLeft(current.eta, t) });
      if (current.speed) return formatSpeed(current.speed);
      return t("plugins.downloader.queue.starting", "Starting");
  }
}

/** A song is one; an album or playlist, its songs saved (in the folder, in the app or both). */
const songsSaved = (job: Job) =>
  job.kind === "song" ? 1 : (job.items?.filter((item) => item.status === "done").length ?? Math.max(job.files.length, job.kept?.length ?? 0));

/** A song still to go, or a download whose songs don't show. */
function TrackRow({ ctx, row, inFront }: { ctx: Ctx; row: Row; inFront: boolean }) {
  const { t } = ctx;
  const { job, item, status } = row;
  const invoke = (command: "cancel" | "retry" | "remove") => () => void ctx.host.invoke(command, job.id);
  const stopped = status === "failed" || status === "cancelled";
  // Whole downloads only: the queue cancels, retries and removes those, not their songs.
  const own = !item;
  const kind = own && job.kind !== "song" && !inFront ? kindWord(ctx, job) : "";
  const running = status === "downloading" || status === "converting";
  return (
    <li class="row" data-status={status}>
      <span class="row-icon">
        <Icon path={ROW_ICONS[status]} />
      </span>
      <div class="row-text">
        <div class="row-title" title={row.title}>
          {row.title}
        </div>
        {kind && <div class="row-sub">{kind}</div>}
      </div>
      {status === "downloading" && <span class="row-state mono">{percent(row.progress)}</span>}
      {status === "converting" && <span class="row-state">{t("plugins.downloader.queue.converting", "Converting")}</span>}
      {status === "paused" && <span class="row-state">{t("plugins.downloader.queue.paused", "Paused")}</span>}
      {status === "queued" && row.job.size !== undefined && own && <span class="row-state mono">{formatBytes(row.job.size)}</span>}
      {stopped && (
        <span class="row-state error" title={row.error}>
          {status === "cancelled" ? t("plugins.downloader.queue.cancelled-short", "Cancelled") : (row.error ?? t("plugins.downloader.queue.failed-short", "Failed"))}
        </span>
      )}
      {stopped && own && (
        <button type="button" class="text-button small" onClick={invoke("retry")}>
          {t("plugins.downloader.queue.retry", "Retry")}
        </button>
      )}
      {own ? (
        <button
          type="button"
          class="icon-button small"
          aria-label={stopped ? t("plugins.downloader.queue.remove", "Remove") : t("plugins.downloader.queue.cancel", "Cancel")}
          title={stopped ? t("plugins.downloader.queue.remove", "Remove") : t("plugins.downloader.queue.cancel", "Cancel")}
          onClick={invoke(stopped ? "remove" : "cancel")}
        >
          <Icon path={ICONS.cancel} />
        </button>
      ) : (
        <span class="icon-space" />
      )}
      {running && (
        <div class="row-progress">
          <div class="bar download" style={{ width: percent(row.progress) }} />
          {status === "converting" && <div class="bar convert" />}
        </div>
      )}
    </li>
  );
}

function kindWord({ t }: Ctx, job: Job) {
  return job.kind === "album" ? t("plugins.downloader.queue.album", "Album") : t("plugins.downloader.queue.playlist", "Playlist");
}

/** "8 finished · 54.1 MiB": opens to the finished downloads, to show, save or remove them. */
function Finished({ ctx, finished }: { ctx: Ctx; finished: readonly Job[] }) {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  const size = finishedSize(finished);
  const label = [t("plugins.downloader.queue.finished", "{{count}} finished", { count: finished.length }), size > 0 && formatBytes(size)].filter(Boolean).join(" · ");
  return (
    <>
      <li class="row finished-row">
        <span class="row-icon">
          <Icon path={ICONS.done} />
        </span>
        <div class="row-text">
          <div class="row-title muted">{label}</div>
        </div>
        <button type="button" class="text-button small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("plugins.downloader.queue.hide", "Hide") : t("plugins.downloader.queue.show-finished", "Show")}
        </button>
        <button type="button" class="text-button small" onClick={() => void ctx.host.invoke("clearFinished")}>
          {t("plugins.downloader.queue.clear", "Clear")}
        </button>
      </li>
      {open && finished.map((job) => <FinishedRow key={job.id} ctx={ctx} job={job} />)}
    </>
  );
}

function FinishedRow({ ctx, job }: { ctx: Ctx; job: Job }) {
  const { t } = ctx;
  // Kept in the app, not saved to the folder (yet).
  const inApp = job.kept?.length && job.files.length === 0 && t("plugins.downloader.queue.in-app", "In the app");
  const line = [job.size !== undefined && formatBytes(job.size), formatWhen(job.finishedAt ?? job.addedAt), inApp].filter(Boolean).join(" · ");
  return (
    <li class="row history" data-status="done">
      <span class="row-icon">
        <Icon path={ICONS[job.kind]} />
      </span>
      <div class="row-text">
        <div class="row-title" title={job.label}>
          {job.label}
        </div>
        <div class="row-sub">{line}</div>
      </div>
      <FinishedActions ctx={ctx} job={job} />
    </li>
  );
}

type Action = { label: string; icon: string; run(): void; disabled?: boolean };

/** Save to the download folder (songs kept in the app), show in folder, remove. */
function FinishedActions({ ctx, job }: { ctx: Ctx; job: Job }) {
  const { t } = ctx;
  const [file] = job.files;
  const [exporting, setExporting] = useState(false);
  const exportSongs: Action = {
    label: exporting ? t("plugins.downloader.popover.exporting", "Saving to the download folder…") : t("plugins.downloader.popover.export", "Save to the download folder"),
    icon: ICONS.export,
    disabled: exporting,
    run: () => {
      setExporting(true);
      ctx.host
        .invoke("export", job.id)
        .catch((error: unknown) => ctx.toast(t("plugins.downloader.toast.cannot-export", "Can't save it to the folder: {{error}}", { error: remoteErrorMessage(error) })))
        .finally(() => setExporting(false));
    },
  };
  const show: Action = {
    label: t("plugins.downloader.popover.show", "Show in folder"),
    icon: ICONS.folder,
    run: () => {
      if (file) void ctx.host.invoke("reveal", file);
    },
  };
  const remove: Action = { label: t("plugins.downloader.queue.remove", "Remove"), icon: ICONS.remove, run: () => void ctx.host.invoke("remove", job.id) };
  const actions = [...(job.kept?.length ? [exportSongs] : []), ...(file ? [show] : []), remove];
  return (
    <span class="actions">
      {actions.map((action) => (
        <button type="button" class="icon-button small" aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.run}>
          <Icon path={action.icon} />
        </button>
      ))}
    </span>
  );
}
