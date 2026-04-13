import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';

import type { IpcRenderer } from 'electron';

// ─── Types (mirror backend) ──────────────────────────────────────────────────

type DownloadItemStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped';

interface DownloadItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  status: DownloadItemStatus;
  progress: number;
  currentProvider: string;
  currentAttempt: number;
  totalProviderAttempts: number;
  error?: string;
  playlistFolder?: string;
  trackId?: string;
  isPlaylist: boolean;
  fileName?: string;
}

interface DownloadManagerState {
  queue: DownloadItem[];
  activeCount: number;
  maxConcurrent: number;
  isPaused: boolean;
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
}

// ─── Icons (inline SVGs) ─────────────────────────────────────────────────────

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const EmptyIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
  </svg>
);

// ─── Status Icon Component ───────────────────────────────────────────────────

const StatusIcon = (props: { status: DownloadItemStatus }) => {
  const icons: Record<DownloadItemStatus, string> = {
    queued: '⏳',
    downloading: '⬇️',
    completed: '✅',
    failed: '❌',
    skipped: '⏭️',
  };
  return <span>{icons[props.status]}</span>;
};

// ─── Main Component ──────────────────────────────────────────────────────────

export interface DownloadManagerProps {
  ipc: {
    send: IpcRenderer['send'];
    invoke: IpcRenderer['invoke'];
    on: (event: string, listener: CallableFunction) => void;
    removeAllListeners: (event: string) => void;
  };
}

type TabType = 'queue' | 'failed' | 'completed';

export function DownloadManagerPanel(props: DownloadManagerProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<TabType>('queue');
  const [items, setItems] = createSignal<DownloadItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = createSignal(1);
  const [isPaused, setIsPaused] = createSignal(false);
  const [totalCompleted, setTotalCompleted] = createSignal(0);
  const [totalFailed, setTotalFailed] = createSignal(0);
  const [totalSkipped, setTotalSkipped] = createSignal(0);

  // Listen for state updates from backend
  const onStateUpdate = (state: DownloadManagerState) => {
    setItems(state.queue);
    setMaxConcurrent(state.maxConcurrent);
    setIsPaused(state.isPaused);
    setTotalCompleted(state.totalCompleted);
    setTotalFailed(state.totalFailed);
    setTotalSkipped(state.totalSkipped);
  };

  const onItemUpdate = (item: DownloadItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  };

  props.ipc.on('download-manager-state', onStateUpdate);
  props.ipc.on('download-manager-item-update', onItemUpdate);

  onCleanup(() => {
    props.ipc.removeAllListeners('download-manager-state');
    props.ipc.removeAllListeners('download-manager-item-update');
  });

  // Get initial state
  props.ipc.invoke('download-manager-get-state').then((state: unknown) => {
    if (state) onStateUpdate(state as DownloadManagerState);
  });

  // Auto-open when downloads start
  createEffect(() => {
    const activeItems = items().filter((i) => i.status === 'downloading' || i.status === 'queued');
    if (activeItems.length > 0 && !isOpen()) {
      setIsOpen(true);
    }
  });

  // ─── Derived data ────────────────────────────────────────────────

  const queueItems = () =>
    items().filter((i) => i.status === 'queued' || i.status === 'downloading');

  const failedItems = () =>
    items().filter((i) => i.status === 'failed');

  const completedItems = () =>
    items().filter((i) => i.status === 'completed' || i.status === 'skipped');

  const activeCount = () =>
    items().filter((i) => i.status === 'downloading').length;

  const currentTabItems = () => {
    switch (activeTab()) {
      case 'queue':
        return queueItems();
      case 'failed':
        return failedItems();
      case 'completed':
        return completedItems();
    }
  };

  const badgeCount = () => queueItems().length + failedItems().length;

  // ─── Actions ─────────────────────────────────────────────────────

  const setConcurrent = (e: Event) => {
    const value = parseInt((e.target as HTMLSelectElement).value, 10);
    props.ipc.invoke('download-manager-set-concurrent', value);
  };

  const togglePause = () => {
    if (isPaused()) {
      props.ipc.invoke('download-manager-resume');
    } else {
      props.ipc.invoke('download-manager-pause');
    }
  };

  const retryFailed = () => {
    props.ipc.invoke('download-manager-retry-failed');
  };

  const retrySingle = (id: string) => {
    props.ipc.invoke('download-manager-retry-single', id);
  };

  const removeFailed = (id: string) => {
    props.ipc.invoke('download-manager-remove-failed', id);
  };

  const clearCompleted = () => {
    props.ipc.invoke('download-manager-clear-completed');
  };

  // ─── Subtitle text ──────────────────────────────────────────────

  const getSubtitle = (item: DownloadItem): string => {
    switch (item.status) {
      case 'queued':
        return 'En cola…';
      case 'downloading':
        return `Descargando… ${item.progress}% — ${item.currentProvider} (${item.currentAttempt}/3)`;
      case 'completed':
        return 'Completada';
      case 'failed':
        return item.error ?? 'Error desconocido';
      case 'skipped':
        return 'Omitida (ya existe)';
      default:
        return '';
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <>
      {/* Toggle Button */}
      <button
        class={`dm-toggle-btn ${isOpen() ? 'dm-active' : ''}`}
        onClick={() => setIsOpen(!isOpen())}
        title="Gestor de Descargas"
        id="ytmd-download-manager-toggle"
      >
        <DownloadIcon />
        <Show when={badgeCount() > 0}>
          <span class="dm-badge">{badgeCount()}</span>
        </Show>
      </button>

      {/* Panel */}
      <div class={`dm-panel ${isOpen() ? 'dm-open' : ''}`} id="ytmd-download-manager-panel">
        {/* Header */}
        <div class="dm-header">
          <div class="dm-header-title">
            <DownloadIcon />
            <span>Gestor de Descargas</span>
          </div>
          <button class="dm-close-btn" onClick={() => setIsOpen(false)}>
            <CloseIcon />
          </button>
        </div>

        {/* Controls */}
        <div class="dm-controls">
          <div class="dm-concurrent-selector">
            <span>Simultáneas:</span>
            <select value={maxConcurrent()} onChange={setConcurrent}>
              <For each={[1, 2, 3, 4, 5]}>
                {(n) => <option value={n}>{n}</option>}
              </For>
            </select>
          </div>
          <button
            class={`dm-ctrl-btn dm-pause`}
            onClick={togglePause}
          >
            {isPaused() ? '▶ Reanudar' : '⏸ Pausar'}
          </button>
          <Show when={failedItems().length > 0}>
            <button class="dm-ctrl-btn dm-retry" onClick={retryFailed}>
              🔄 Reintentar ({failedItems().length})
            </button>
          </Show>
          <Show when={completedItems().length > 0}>
            <button class="dm-ctrl-btn dm-clear" onClick={clearCompleted}>
              🗑️ Limpiar
            </button>
          </Show>
        </div>

        {/* Tabs */}
        <div class="dm-tabs">
          <button
            class={`dm-tab ${activeTab() === 'queue' ? 'dm-tab-active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            📥 Cola
            <Show when={queueItems().length > 0}>
              <span class="dm-tab-badge">{queueItems().length}</span>
            </Show>
          </button>
          <button
            class={`dm-tab ${activeTab() === 'failed' ? 'dm-tab-active' : ''}`}
            onClick={() => setActiveTab('failed')}
          >
            ❌ Fallidas
            <Show when={failedItems().length > 0}>
              <span class="dm-tab-badge">{failedItems().length}</span>
            </Show>
          </button>
          <button
            class={`dm-tab ${activeTab() === 'completed' ? 'dm-tab-active' : ''}`}
            onClick={() => setActiveTab('completed')}
          >
            ✅ Listas
            <Show when={completedItems().length > 0}>
              <span class="dm-tab-badge">{completedItems().length}</span>
            </Show>
          </button>
        </div>

        {/* List */}
        <div class="dm-list">
          <Show
            when={currentTabItems().length > 0}
            fallback={
              <div class="dm-empty">
                <EmptyIcon />
                <span>No hay descargas</span>
              </div>
            }
          >
            <For each={currentTabItems()}>
              {(item) => (
                <div class="dm-item">
                  <div class={`dm-item-icon dm-${item.status}`}>
                    <StatusIcon status={item.status} />
                  </div>
                  <div class="dm-item-info">
                    <div class="dm-item-title">
                      {item.artist ? `${item.artist} - ${item.title}` : item.title}
                    </div>
                    <div class="dm-item-subtitle">{getSubtitle(item)}</div>
                    <Show when={item.status === 'downloading'}>
                      <div class="dm-item-progress">
                        <div
                          class="dm-item-progress-bar"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </Show>
                  </div>
                  <Show when={item.status === 'failed'}>
                    <div class="dm-item-actions">
                      <button
                        class="dm-item-action-btn dm-retry-btn"
                        onClick={() => retrySingle(item.id)}
                        title="Reintentar"
                      >
                        🔄
                      </button>
                      <button
                        class="dm-item-action-btn dm-remove-btn"
                        onClick={() => removeFailed(item.id)}
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* Stats */}
        <div class="dm-stats">
          <div class="dm-stat">
            ⬇️ <span class="dm-stat-value">{activeCount()}</span> activas
          </div>
          <div class="dm-stat dm-stat-completed">
            ✅ <span class="dm-stat-value">{totalCompleted()}</span>
          </div>
          <div class="dm-stat dm-stat-failed">
            ❌ <span class="dm-stat-value">{totalFailed()}</span>
          </div>
          <div class="dm-stat dm-stat-skipped">
            ⏭️ <span class="dm-stat-value">{totalSkipped()}</span>
          </div>
        </div>
      </div>
    </>
  );
}
