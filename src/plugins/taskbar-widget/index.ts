import prompt from 'custom-electron-prompt';
import { screen } from 'electron';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { Platform } from '@/types/plugins';

import type { MenuContext } from '@/types/contexts';

export type VisualizerPosition = 'left' | 'right';

export type TaskbarWidgetPluginConfig = {
  enabled: boolean;
  monitorIndex: number;
  offsetX: number;
  offsetY: number;
  backgroundBlur: boolean;
  blurOpacity: number;
  visualizer: {
    enabled: boolean;
    position: VisualizerPosition;
    width: number;
    barCount: number;
    centeredBars: boolean;
    showBaseline: boolean;
    audioSensitivity: number;
    audioPeakThreshold: number;
  };
};

let cleanupFn: (() => void) | null = null;
let updateConfigFn: ((config: TaskbarWidgetPluginConfig) => void) | null = null;

export default createPlugin({
  name: () => t('plugins.taskbar-widget.name'),
  description: () => t('plugins.taskbar-widget.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
    monitorIndex: 0,
    offsetX: 0,
    offsetY: 0,
    backgroundBlur: false,
    blurOpacity: 0.5,
    visualizer: {
      enabled: false,
      position: 'left' as VisualizerPosition,
      width: 84,
      barCount: 20,
      centeredBars: true,
      showBaseline: true,
      audioSensitivity: 0.3,
      audioPeakThreshold: 0.85,
    },
  } as TaskbarWidgetPluginConfig,

  menu: async ({
    getConfig,
    setConfig,
    window: win,
  }: MenuContext<TaskbarWidgetPluginConfig>) => {
    const config = await getConfig();
    const displays = screen.getAllDisplays();

    return [
      {
        label: t('plugins.taskbar-widget.menu.monitor.label'),
        submenu: displays.map((display, index) => ({
          label:
            index === 0
              ? `${t('plugins.taskbar-widget.menu.monitor.primary')} (${display.bounds.width}x${display.bounds.height})`
              : `${index + 1} (${display.bounds.width}x${display.bounds.height})`,
          type: 'radio' as const,
          checked: config.monitorIndex === index,
          click() {
            setConfig({ monitorIndex: index });
          },
        })),
      },
      {
        label: t('plugins.taskbar-widget.menu.position.label'),
        click: async () => {
          // Read config fresh each time so previously saved values are shown
          const currentConfig = await getConfig();
          const res = await prompt(
            {
              title: t('plugins.taskbar-widget.menu.position.label'),
              type: 'multiInput',
              multiInputOptions: [
                {
                  label: t(
                    'plugins.taskbar-widget.menu.position.horizontal-offset',
                  ),
                  value: currentConfig.offsetX,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    step: '1',
                  },
                },
                {
                  label: t(
                    'plugins.taskbar-widget.menu.position.vertical-offset',
                  ),
                  value: currentConfig.offsetY,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    step: '1',
                  },
                },
              ],
              resizable: true,
              height: 260,
              ...promptOptions(),
            },
            win,
          ).catch(console.error);

          if (res) {
            const newOffsetX = Number(res[0]);
            const newOffsetY = Number(res[1]);
            setConfig({
              offsetX: Number.isFinite(newOffsetX) ? newOffsetX : 0,
              offsetY: Number.isFinite(newOffsetY) ? newOffsetY : 0,
            });
          }
        },
      },
      {
        label: t('plugins.taskbar-widget.menu.background-blur'),
        type: 'checkbox' as const,
        checked: config.backgroundBlur,
        click(item: Electron.MenuItem) {
          setConfig({ backgroundBlur: item.checked });
        },
      },
      {
        label: t('plugins.taskbar-widget.menu.blur-opacity'),
        click: async () => {
          const currentConfig = await getConfig();
          const res = await prompt(
            {
              title: t('plugins.taskbar-widget.menu.blur-opacity'),
              type: 'input',
              value: String(currentConfig.blurOpacity),
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0.1',
                max: '1.0',
                step: '0.05',
              },
              resizable: true,
              height: 200,
              ...promptOptions(),
            },
            win,
          ).catch(console.error);
          if (res != null) {
            const val = Math.max(0.1, Math.min(1.0, Number(res)));
            if (Number.isFinite(val)) {
              setConfig({ blurOpacity: val });
            }
          }
        },
      },
      { type: 'separator' as const },
      {
        label: t('plugins.taskbar-widget.menu.visualizer.label'),
        submenu: [
          {
            label: t('plugins.taskbar-widget.menu.visualizer.enabled'),
            type: 'checkbox' as const,
            checked: config.visualizer.enabled,
            click(item: Electron.MenuItem) {
              setConfig({
                visualizer: { ...config.visualizer, enabled: item.checked },
              });
            },
          },
          {
            label: t('plugins.taskbar-widget.menu.visualizer.position.label'),
            submenu: [
              {
                label: t(
                  'plugins.taskbar-widget.menu.visualizer.position.left',
                ),
                type: 'radio' as const,
                checked: config.visualizer.position === 'left',
                click() {
                  setConfig({
                    visualizer: { ...config.visualizer, position: 'left' },
                  });
                },
              },
              {
                label: t(
                  'plugins.taskbar-widget.menu.visualizer.position.right',
                ),
                type: 'radio' as const,
                checked: config.visualizer.position === 'right',
                click() {
                  setConfig({
                    visualizer: { ...config.visualizer, position: 'right' },
                  });
                },
              },
            ],
          },
          {
            label: t('plugins.taskbar-widget.menu.visualizer.width'),
            click: async () => {
              const currentConfig = await getConfig();
              const res = await prompt(
                {
                  title: t('plugins.taskbar-widget.menu.visualizer.width'),
                  type: 'input',
                  value: String(currentConfig.visualizer.width),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '40',
                    max: '300',
                    step: '1',
                  },
                  resizable: true,
                  height: 200,
                  ...promptOptions(),
                },
                win,
              ).catch(console.error);
              if (res != null) {
                const val = Math.max(40, Math.min(300, Number(res)));
                if (Number.isFinite(val)) {
                  setConfig({
                    visualizer: {
                      ...currentConfig.visualizer,
                      width: val,
                    },
                  });
                }
              }
            },
          },
          {
            label: t('plugins.taskbar-widget.menu.visualizer.bar-count'),
            click: async () => {
              const currentConfig = await getConfig();
              const res = await prompt(
                {
                  title: t('plugins.taskbar-widget.menu.visualizer.bar-count'),
                  type: 'input',
                  value: String(currentConfig.visualizer.barCount),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '4',
                    max: '64',
                    step: '1',
                  },
                  resizable: true,
                  height: 200,
                  ...promptOptions(),
                },
                win,
              ).catch(console.error);
              if (res != null) {
                const count = Math.max(4, Math.min(64, Number(res)));
                if (Number.isFinite(count)) {
                  setConfig({
                    visualizer: {
                      ...currentConfig.visualizer,
                      barCount: count,
                    },
                  });
                }
              }
            },
          },
          {
            label: t('plugins.taskbar-widget.menu.visualizer.centered-bars'),
            type: 'checkbox' as const,
            checked: config.visualizer.centeredBars,
            click(item: Electron.MenuItem) {
              setConfig({
                visualizer: {
                  ...config.visualizer,
                  centeredBars: item.checked,
                },
              });
            },
          },
          {
            label: t('plugins.taskbar-widget.menu.visualizer.show-baseline'),
            type: 'checkbox' as const,
            checked: config.visualizer.showBaseline,
            click(item: Electron.MenuItem) {
              setConfig({
                visualizer: {
                  ...config.visualizer,
                  showBaseline: item.checked,
                },
              });
            },
          },
          {
            label: t(
              'plugins.taskbar-widget.menu.visualizer.audio-sensitivity',
            ),
            click: async () => {
              const currentConfig = await getConfig();
              const res = await prompt(
                {
                  title: t(
                    'plugins.taskbar-widget.menu.visualizer.audio-sensitivity',
                  ),
                  type: 'input',
                  value: String(currentConfig.visualizer.audioSensitivity),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '0.01',
                    max: '1.0',
                    step: '0.05',
                  },
                  resizable: true,
                  height: 200,
                  ...promptOptions(),
                },
                win,
              ).catch(console.error);
              if (res != null) {
                const val = Math.max(0.01, Math.min(1.0, Number(res)));
                if (Number.isFinite(val)) {
                  setConfig({
                    visualizer: {
                      ...currentConfig.visualizer,
                      audioSensitivity: val,
                    },
                  });
                }
              }
            },
          },
          {
            label: t(
              'plugins.taskbar-widget.menu.visualizer.audio-peak-threshold',
            ),
            click: async () => {
              const currentConfig = await getConfig();
              const res = await prompt(
                {
                  title: t(
                    'plugins.taskbar-widget.menu.visualizer.audio-peak-threshold',
                  ),
                  type: 'input',
                  value: String(currentConfig.visualizer.audioPeakThreshold),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '0.1',
                    max: '1.0',
                    step: '0.05',
                  },
                  resizable: true,
                  height: 200,
                  ...promptOptions(),
                },
                win,
              ).catch(console.error);
              if (res != null) {
                const val = Math.max(0.1, Math.min(1.0, Number(res)));
                if (Number.isFinite(val)) {
                  setConfig({
                    visualizer: {
                      ...currentConfig.visualizer,
                      audioPeakThreshold: val,
                    },
                  });
                }
              }
            },
          },
        ],
      },
    ];
  },

  renderer: {
    audioContext: null as AudioContext | null,
    audioSource: null as MediaElementAudioSourceNode | null,
    analyser: null as AnalyserNode | null,
    animationFrame: null as number | null,
    ipcSend: null as ((channel: string, ...args: unknown[]) => void) | null,

    start({ ipc }) {
      this.ipcSend = ipc.send;
    },

    onPlayerApiReady(_, { ipc }) {
      document.addEventListener(
        'peard:audio-can-play',
        (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            audioContext: AudioContext;
            audioSource: MediaElementAudioSourceNode;
          };
          this.audioContext = detail.audioContext;
          this.audioSource = detail.audioSource;
          this.startAnalysis(ipc.send);
        },
        { passive: true },
      );
    },

    startAnalysis(
      this: {
        audioContext: AudioContext | null;
        audioSource: MediaElementAudioSourceNode | null;
        analyser: AnalyserNode | null;
        animationFrame: number | null;
        ipcSend: ((channel: string, ...args: unknown[]) => void) | null;
      },
      send: (channel: string, ...args: unknown[]) => void,
    ) {
      if (!this.audioContext || !this.audioSource) return;

      // Clean up any previous analyser
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.audioSource.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const analyserRef = this.analyser;
      let lastSendTime = 0;

      const loop = () => {
        this.animationFrame = requestAnimationFrame(loop);
        // Throttle to ~30fps to reduce IPC overhead
        const now = performance.now();
        if (now - lastSendTime < 33) return;
        lastSendTime = now;

        analyserRef.getByteFrequencyData(dataArray);
        send('taskbar-widget:audio-data', Array.from(dataArray));
      };

      loop();
    },

    stop() {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      this.analyser = null;
      this.audioContext = null;
      this.audioSource = null;
    },
  },

  backend: {
    async start({ window: mainWindow, getConfig }) {
      const { createMiniPlayer, cleanup, updateConfig } =
        await import('./main');
      const config = await getConfig();

      await createMiniPlayer(mainWindow, config);

      cleanupFn = cleanup;
      updateConfigFn = updateConfig;
    },
    onConfigChange(newConfig) {
      updateConfigFn?.(newConfig);
    },
    stop() {
      cleanupFn?.();
      cleanupFn = null;
      updateConfigFn = null;
    },
  },
});
