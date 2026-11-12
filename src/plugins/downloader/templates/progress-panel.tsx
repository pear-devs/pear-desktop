import { For, Show } from 'solid-js';

import { t } from '@/i18n';

import { type DownloadTask, isFinishedStatus } from '../types';

/** Inline svg icon, sized through the class of the surrounding element */
const Icon = (props: { path: string; class?: string }) => (
  <svg aria-hidden="true" class={props.class} viewBox="0 0 24 24">
    <path d={props.path} />
  </svg>
);

const ICONS = {
  download: 'M5 20h14v-2H5v2zm7-18L5.33 12H10v4h4v-4h4.67L12 2z',
  close:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  retry:
    'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  clear: 'M5 19h14v2H5v-2zm7-17 5 5-4 4-5-5 4-4zM3 13l4-4 5 5-4 4H3v-5z',
} as const;

/** Translated label of a task status */
const statusLabel = (task: DownloadTask) =>
  t(`plugins.downloader.renderer.panel.status.${task.status}`);

/** Progress in percent, empty while it is unknown or no longer moving */
const percentLabel = (task: DownloadTask) =>
  task.progress >= 0 && !isFinishedStatus(task.status)
    ? `${Math.min(Math.round(task.progress * 100), 100)}%`
    : '';

/** A single download, with its cancel, retry and dismiss actions */
const TaskRow = (props: {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) => {
  const finished = () => isFinishedStatus(props.task.status);

  return (
    <li
      class="ytmd-downloader-task"
      classList={{
        'ytmd-downloader-task--error': props.task.status === 'error',
        'ytmd-downloader-task--done': props.task.status === 'done',
      }}
    >
      <div class="ytmd-downloader-task__head">
        <div class="ytmd-downloader-task__labels">
          <span class="ytmd-downloader-task__title" title={props.task.title}>
            {props.task.title}
          </span>
          <Show when={props.task.artist}>
            <span class="ytmd-downloader-task__artist">
              {props.task.artist}
            </span>
          </Show>
        </div>

        <Show when={!finished()}>
          <button
            class="ytmd-downloader-icon-button"
            onClick={() => props.onCancel(props.task.id)}
            title={t('plugins.downloader.renderer.panel.actions.cancel')}
            type="button"
          >
            <Icon path={ICONS.close} />
          </button>
        </Show>

        <Show
          when={
            finished() && props.task.status === 'error' && props.task.retryable
          }
        >
          <button
            class="ytmd-downloader-icon-button"
            onClick={() => props.onRetry(props.task.id)}
            title={t('plugins.downloader.renderer.panel.actions.retry')}
            type="button"
          >
            <Icon path={ICONS.retry} />
          </button>
        </Show>

        <Show when={finished()}>
          <button
            class="ytmd-downloader-icon-button"
            onClick={() => props.onDismiss(props.task.id)}
            title={t('plugins.downloader.renderer.panel.actions.dismiss')}
            type="button"
          >
            <Icon path={ICONS.close} />
          </button>
        </Show>
      </div>

      <div class="ytmd-downloader-task__meta">
        <span class="ytmd-downloader-task__status">
          {statusLabel(props.task)}
        </span>
        <Show when={props.task.playlistTitle}>
          <span class="ytmd-downloader-task__badge">
            {t('plugins.downloader.renderer.panel.playlist', {
              title: props.task.playlistTitle,
              index: props.task.playlistIndex,
              size: props.task.playlistSize,
            })}
          </span>
        </Show>
        <Show when={props.task.automatic}>
          <span class="ytmd-downloader-task__badge">
            {t('plugins.downloader.renderer.panel.automatic')}
          </span>
        </Show>
        <span class="ytmd-downloader-task__percent">
          {percentLabel(props.task)}
        </span>
      </div>

      <Show when={!finished()}>
        <div
          class="ytmd-downloader-progress"
          classList={{
            'ytmd-downloader-progress--indeterminate': props.task.progress < 0,
          }}
        >
          <div
            class="ytmd-downloader-progress__fill"
            style={{
              width:
                props.task.progress >= 0
                  ? `${Math.min(props.task.progress * 100, 100)}%`
                  : '100%',
            }}
          />
        </div>
      </Show>

      <Show when={props.task.error}>
        <div class="ytmd-downloader-task__error" title={props.task.error}>
          {props.task.error}
        </div>
      </Show>
    </li>
  );
};

/** Panel listing the running and the recently finished downloads */
export const DownloadProgressPanel = (props: {
  tasks: DownloadTask[];
  collapsed: boolean;
  onToggle: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClear: () => void;
}) => {
  const activeCount = () =>
    props.tasks.filter((task) => !isFinishedStatus(task.status)).length;
  const hasFinished = () =>
    props.tasks.some((task) => isFinishedStatus(task.status));

  return (
    <div
      class="ytmd-downloader-panel"
      classList={{ 'ytmd-downloader-panel--collapsed': props.collapsed }}
    >
      <div class="ytmd-downloader-panel__header">
        <Icon class="ytmd-downloader-panel__icon" path={ICONS.download} />
        <span class="ytmd-downloader-panel__title">
          {t('plugins.downloader.renderer.panel.title')}
        </span>
        <span class="ytmd-downloader-panel__count">
          {activeCount() > 0
            ? t('plugins.downloader.renderer.panel.active', {
                count: activeCount(),
              })
            : t('plugins.downloader.renderer.panel.idle')}
        </span>

        <Show when={hasFinished()}>
          <button
            class="ytmd-downloader-icon-button"
            onClick={() => props.onClear()}
            title={t('plugins.downloader.renderer.panel.actions.clear')}
            type="button"
          >
            <Icon path={ICONS.clear} />
          </button>
        </Show>

        <button
          class="ytmd-downloader-icon-button ytmd-downloader-panel__toggle"
          onClick={() => props.onToggle()}
          title={t(
            props.collapsed
              ? 'plugins.downloader.renderer.panel.actions.expand'
              : 'plugins.downloader.renderer.panel.actions.collapse',
          )}
          type="button"
        >
          <Icon path={ICONS.chevron} />
        </button>
      </div>

      <Show when={!props.collapsed}>
        <ul class="ytmd-downloader-panel__list">
          <For each={props.tasks}>
            {(task) => (
              <TaskRow
                onCancel={props.onCancel}
                onDismiss={props.onDismiss}
                onRetry={props.onRetry}
                task={task}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};
