// What the Downloads popover shows: chips to filter by status, a two-line row
// per download with its actions, the songs of an album or playlist under it,
// and a footer for all of them; and the queue on the Downloads page, with the
// same rows. Preact, rendered while they show.

import { useEffect, useState } from "preact/hooks";
import { remoteErrorMessage } from "@pear/sdk/util";
import type { Job, JobItem } from "../jobs.ts";
import { isFinished } from "../jobs.ts";
import { formatBytes, formatSpeed, formatTimeLeft, formatWhen } from "./format.ts";
import type { Ctx } from "./types.ts";
import { inView, newestFirst, type View, VIEWS, viewCounts } from "./views.ts";

// Material icons.
const ICONS = {
  song: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
  album: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  playlist: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 0 0 16 14a3 3 0 1 0 3 3V8h3V6h-5z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  resume: "M8 5v14l11-7z",
  cancel: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  retry: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  remove: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  folder: "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
  export: "M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67 2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z",
  chevron: "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** The jobs, asked for when the popover opens and then as they change. */
function useJobs(ctx: Ctx) {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    const off = ctx.host.on("jobs", (payload) => setJobs(payload as Job[]));
    ctx.host.invoke("jobs").then(setJobs, () => {});
    return off;
  }, []);
  return jobs;
}

/** Albums and playlists show their songs while they download, unless the user said otherwise. */
function useExpanded() {
  const [chosen, setChosen] = useState(new Map<number, boolean>());
  const isExpanded = (job: Job) => chosen.get(job.id) ?? job.status === "active";
  const toggle = (job: Job) => setChosen(new Map(chosen).set(job.id, !isExpanded(job)));
  return [isExpanded, toggle] as const;
}

export function Downloads({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const jobs = useJobs(ctx);
  const [view, setView] = useState<View>("all");
  const [isExpanded, toggle] = useExpanded();
  const counts = viewCounts(jobs);
  const shown = newestFirst(jobs.filter((job) => inView(view, job)));
  const chipLabels: Record<View, string> = {
    all: t("plugins.downloader.popover.views.all", "All"),
    downloading: t("plugins.downloader.popover.views.downloading", "Downloading"),
    finished: t("plugins.downloader.popover.views.finished", "Finished"),
    failed: t("plugins.downloader.popover.views.failed", "Failed"),
    cancelled: t("plugins.downloader.popover.views.cancelled", "Cancelled"),
  };
  return (
    <div class="pear-dl-downloads">
      <div class="chips" role="radiogroup" aria-label={t("plugins.downloader.popover.views-label", "Show")}>
        {VIEWS.map((option) => (
          <button type="button" class="chip" role="radio" aria-checked={view === option} onClick={() => setView(option)}>
            {chipLabels[option]}
            {option !== "all" && <span class="count">{counts[option]}</span>}
          </button>
        ))}
      </div>
      {shown.length > 0 ? (
        <ul class="rows">
          {shown.map((job) => (
            <JobRow key={job.id} ctx={ctx} job={job} expanded={isExpanded(job)} onToggle={() => toggle(job)} />
          ))}
        </ul>
      ) : (
        <p class="empty">{emptyText(ctx, view)}</p>
      )}
      <Footer ctx={ctx} jobs={jobs} />
    </div>
  );
}

/** The Downloads page's queue: what is downloading, waiting, paused, failed or cancelled; nothing when all are done. */
export function Queue({ ctx }: { ctx: Ctx }) {
  const jobs = useJobs(ctx);
  const [isExpanded, toggle] = useExpanded();
  const queued = newestFirst(jobs.filter((job) => job.status !== "done"));
  if (queued.length === 0) return null;
  return (
    <section class="pear-dl-downloads">
      <h2 class="heading">{ctx.t("plugins.downloader.page.queue", "Download queue")}</h2>
      <ul class="rows">
        {queued.map((job) => (
          <JobRow key={job.id} ctx={ctx} job={job} expanded={isExpanded(job)} onToggle={() => toggle(job)} />
        ))}
      </ul>
    </section>
  );
}

function emptyText({ t }: Ctx, view: View) {
  switch (view) {
    case "all":
      return t("plugins.downloader.popover.empty.all", "Nothing downloaded yet");
    case "downloading":
      return t("plugins.downloader.popover.empty.downloading", "Nothing is downloading");
    case "finished":
      return t("plugins.downloader.popover.empty.finished", "No finished downloads");
    case "failed":
      return t("plugins.downloader.popover.empty.failed", "No failed downloads");
    case "cancelled":
      return t("plugins.downloader.popover.empty.cancelled", "No cancelled downloads");
  }
}

function JobRow({ ctx, job, expanded, onToggle }: { ctx: Ctx; job: Job; expanded: boolean; onToggle(): void }) {
  const { t } = ctx;
  const songs = job.kind === "song" ? [] : (job.items ?? []);
  return (
    <li class="job" data-status={job.status}>
      <div class="line">
        {songs.length > 0 ? (
          <button
            type="button"
            class="chevron"
            aria-expanded={expanded}
            aria-label={expanded ? t("plugins.downloader.popover.collapse", "Hide the songs") : t("plugins.downloader.popover.expand", "Show the songs")}
            onClick={onToggle}
          >
            <Icon path={ICONS.chevron} />
          </button>
        ) : (
          <span class="chevron" />
        )}
        <span class="kind">
          <Icon path={ICONS[job.kind]} />
        </span>
        <span class="title" title={job.label}>
          {job.label}
        </span>
        <Actions ctx={ctx} job={job} />
      </div>
      <div class="status" title={job.error}>
        {jobLine(ctx, job)}
      </div>
      {job.status === "active" && <progress max={1} value={job.progress} />}
      {expanded && songs.length > 0 && (
        <ul class="songs">
          {songs.map((item) => (
            <SongRow ctx={ctx} item={item} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SongRow({ ctx, item }: { ctx: Ctx; item: JobItem }) {
  return (
    <li class="song" data-status={item.status} title={item.error}>
      <span class="title">{item.title || "…"}</span>
      <span class="song-status">{songLine(ctx, item)}</span>
    </li>
  );
}

type Action = { label: string; icon: string; run(): void; disabled?: boolean };

/** The row's icon actions, by status. */
function Actions({ ctx, job }: { ctx: Ctx; job: Job }) {
  const { t } = ctx;
  const invoke = (command: "pause" | "resume" | "cancel" | "retry" | "remove") => () => void ctx.host.invoke(command, job.id);
  const pause = { label: t("plugins.downloader.popover.pause", "Pause"), icon: ICONS.pause, run: invoke("pause") };
  const resume = { label: t("plugins.downloader.popover.resume", "Resume"), icon: ICONS.resume, run: invoke("resume") };
  const cancel = { label: t("plugins.downloader.popover.cancel", "Cancel"), icon: ICONS.cancel, run: invoke("cancel") };
  const retry = { label: t("plugins.downloader.popover.retry", "Retry"), icon: ICONS.retry, run: invoke("retry") };
  const remove = { label: t("plugins.downloader.popover.remove", "Remove"), icon: ICONS.remove, run: invoke("remove") };
  const [file] = job.files;
  const [exporting, setExporting] = useState(false);
  // Songs kept in the app go to the download folder.
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
  const show = { label: t("plugins.downloader.popover.show", "Show in folder"), icon: ICONS.folder, run: () => {
      if (file) void ctx.host.invoke("reveal", file);
    },
  };
  const actions: Record<Job["status"], Action[]> = {
    active: [pause, cancel],
    paused: [resume, cancel],
    queued: [cancel],
    failed: [retry, remove],
    cancelled: [retry, remove],
    done: [...(job.kept?.length ? [exportSongs] : []), ...(file ? [show] : []), remove],
  };
  return (
    <span class="actions">
      {actions[job.status].map((action) => (
        <button type="button" class="action" aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.run}>
          <Icon path={action.icon} />
        </button>
      ))}
    </span>
  );
}

/** "3.2 of 8.1 MiB · 1.4 MiB/s · 4 s left" while it runs; the size and when once finished. */
function jobLine(ctx: Ctx, job: Job) {
  const { t } = ctx;
  switch (job.status) {
    case "queued":
      return t("plugins.downloader.popover.status.queued", "Queued");
    case "active":
      return runningLine(ctx, job);
    case "paused":
      return t("plugins.downloader.popover.status.paused", "Paused");
    case "done": {
      // Kept in the app, not saved to the folder (yet).
      const inApp = job.kept?.length && job.files.length === 0 && t("plugins.downloader.popover.status.in-app", "In the app");
      return [job.size !== undefined && formatBytes(job.size), formatWhen(job.finishedAt ?? job.addedAt), inApp].filter(Boolean).join(" · ");
    }
    case "failed":
      return job.error ?? t("plugins.downloader.popover.status.failed", "Failed");
    case "cancelled":
      return t("plugins.downloader.popover.status.cancelled", "Cancelled");
  }
}

function runningLine(ctx: Ctx, job: Job) {
  const { t } = ctx;
  if (job.stage === "converting") return t("plugins.downloader.popover.status.converting", "Converting");
  if (job.size === undefined) return t("plugins.downloader.popover.status.starting", "Starting");
  const parts = [sizeOf(ctx, job)];
  if (job.speed) parts.push(formatSpeed(job.speed));
  if (job.eta !== undefined) parts.push(t("plugins.downloader.popover.status.left", "{{time}} left", { time: formatTimeLeft(job.eta, t) }));
  return parts.join(" · ");
}

function songLine(ctx: Ctx, item: JobItem) {
  const { t } = ctx;
  switch (item.status) {
    case "queued":
      return t("plugins.downloader.popover.status.queued", "Queued");
    case "active":
      return item.size === undefined ? t("plugins.downloader.popover.status.downloading", "Downloading") : sizeOf(ctx, item);
    case "done":
      return item.size === undefined ? "" : formatBytes(item.size);
    case "failed":
      return t("plugins.downloader.popover.status.failed", "Failed");
    case "skipped":
      return t("plugins.downloader.popover.status.skipped", "Already downloaded");
  }
}

/** "3.2 MiB of 8.1 MiB". */
function sizeOf({ t }: Ctx, { size, downloaded }: { size?: number; downloaded?: number }) {
  return t("plugins.downloader.popover.size-of", "{{downloaded}} of {{size}}", { downloaded: formatBytes(downloaded ?? 0), size: formatBytes(size ?? 0) });
}

function Footer({ ctx, jobs }: { ctx: Ctx; jobs: readonly Job[] }) {
  const { t } = ctx;
  const running = jobs.some((job) => job.status === "active" || job.status === "queued");
  const paused = jobs.some((job) => job.status === "paused");
  return (
    <footer class="footer">
      <button type="button" onClick={() => void ctx.host.invoke("openFolder")}>
        {t("plugins.downloader.popover.open-folder", "Open folder")}
      </button>
      {!running && paused ? (
        <button type="button" onClick={() => void ctx.host.invoke("resume")}>
          {t("plugins.downloader.popover.resume-all", "Resume all")}
        </button>
      ) : (
        <button type="button" disabled={!running} onClick={() => void ctx.host.invoke("pause")}>
          {t("plugins.downloader.popover.pause-all", "Pause all")}
        </button>
      )}
      <button type="button" disabled={!jobs.some(isFinished)} onClick={() => void ctx.host.invoke("clearFinished")}>
        {t("plugins.downloader.popover.clear-finished", "Clear finished")}
      </button>
    </footer>
  );
}
