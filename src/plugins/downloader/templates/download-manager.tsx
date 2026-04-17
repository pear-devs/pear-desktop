import { createSignal, createEffect, For, Show, onCleanup, onMount } from 'solid-js';

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

// Toast notification interface
interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  countdown: number;
}

export function DownloadManagerPanel(props: DownloadManagerProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<TabType>('queue');
  const [items, setItems] = createSignal<DownloadItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = createSignal(1);
  const [isPaused, setIsPaused] = createSignal(false);
  const [totalCompleted, setTotalCompleted] = createSignal(0);
  const [totalFailed, setTotalFailed] = createSignal(0);
  const [totalSkipped, setTotalSkipped] = createSignal(0);

  // Draggable window state
  const [position, setPosition] = createSignal({ x: window.innerWidth - 420, y: 50 });
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

  // Toast notifications state
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [previousQueueLength, setPreviousQueueLength] = createSignal(0);
  const [notifiedPlaylists, setNotifiedPlaylists] = createSignal<Set<string>>(new Set());

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

  // Listen for toggle event from title bar
  onMount(() => {
    const handleToggle = () => setIsOpen(!isOpen());
    window.addEventListener('ytmd-download-manager-toggle', handleToggle);
    onCleanup(() => window.removeEventListener('ytmd-download-manager-toggle', handleToggle));
  });

  // Show toast notification when new downloads start
  createEffect(() => {
    const currentItems = items();
    const queuedItems = currentItems.filter(
      (i) => i.status === 'queued' || i.status === 'downloading'
    );
    const currentQueueLength = queuedItems.length;

    // Check if new items were added
    if (currentQueueLength > previousQueueLength()) {
      const newQueuedItems = currentItems.filter((i) => i.status === 'queued');
      
      // Group by playlist to detect new playlists
      const playlistGroups = new Map<string, DownloadItem[]>();
      const individualSongs: DownloadItem[] = [];
      
      newQueuedItems.forEach(item => {
        if (item.isPlaylist && item.playlistFolder) {
          if (!playlistGroups.has(item.playlistFolder)) {
            playlistGroups.set(item.playlistFolder, []);
          }
          playlistGroups.get(item.playlistFolder)!.push(item);
        } else {
          individualSongs.push(item);
        }
      });

      // Notify for new playlists
      const currentNotified = notifiedPlaylists();
      const newNotified = new Set(currentNotified);
      
      playlistGroups.forEach((playlistItems, playlistName) => {
        if (!currentNotified.has(playlistName)) {
          const playlistTitle = playlistItems[0]?.title || playlistName;
          const songCount = playlistItems.length;
          addToast(`Descargando playlist: ${playlistTitle} (${songCount} canciones)`, 'info');
          newNotified.add(playlistName);
        }
      });

      // Notify for individual songs (only if not part of a playlist)
      if (individualSongs.length > 0) {
        addToast(`Descarga iniciada - Ver en el botón del gestor`, 'info');
      }

      setNotifiedPlaylists(newNotified);
    }

    setPreviousQueueLength(currentQueueLength);
  });

  // Toast functions
  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Date.now().toString();
    const toast: Toast = { id, message, type, countdown: 5 };
    setToasts((prev) => [...prev, toast]);

    // Auto remove after 5 seconds
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Drag functions
  const handleMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dm-close-btn, .dm-tab, .dm-ctrl-btn, .dm-item-action-btn, select')) {
      return;
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position().x,
      y: e.clientY - position().y,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragOffset().x));
    const newY = Math.max(32, Math.min(window.innerHeight - 500, e.clientY - dragOffset().y));
    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Global mouse events for dragging
  onMount(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    onCleanup(() => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    });
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

  // Expose badge count to window for title bar button
  createEffect(() => {
    (window as unknown as { ytmdDownloadBadgeCount: number }).ytmdDownloadBadgeCount = badgeCount();
    window.dispatchEvent(new CustomEvent('ytmd-download-badge-update', { detail: badgeCount() }));
  });

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
      {/* Toast Notifications */}
      <div class="dm-toast-container">
        <For each={toasts()}>
          {(toast) => (
            <div class={`dm-toast dm-toast-${toast.type}`}>
              <span class="dm-toast-message">{toast.message}</span>
              <button class="dm-toast-close" onClick={() => removeToast(toast.id)}>
                <CloseIcon />
              </button>
            </div>
          )}
        </For>
      </div>

      {/* Floating Panel */}
      <Show when={isOpen()}>
        <div
          class="dm-floating-panel"
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`,
          }}
          onMouseDown={handleMouseDown}
        >
          {/* Header with drag handle */}
          <div class="dm-header dm-drag-handle">
            <div class="dm-header-title">
              <DownloadIcon />
              <span>Gestor de Descargas</span>
              <span class="dm-drag-hint">⣿</span>
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
      </Show>
    </>
  );
}
