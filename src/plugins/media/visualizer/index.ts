import emptyStyle from './empty-player.css?inline';
import { createPlugin } from '@/utils';
import { type Visualizer } from './visualizers/visualizer';
import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { t } from '@/i18n';

type WaveColor = {
  gradient: string[];
  rotate?: number;
};

export type VisualizerPluginConfig = {
  enabled: boolean;
  type: 'butterchurn' | 'vudio' | 'wave';
  butterchurn: {
    preset: string;
    renderingFrequencyInMs: number;
    blendTimeInSeconds: number;
  };
  vudio: {
    effect: string;
    accuracy: number;
    lighting: {
      maxHeight: number;
      maxSize: number;
      lineWidth: number;
      color: string;
      shadowBlur: number;
      shadowColor: string;
      fadeSide: boolean;
      prettify: boolean;
      horizontalAlign: string;
      verticalAlign: string;
      dottify: boolean;
    };
  };
  wave: {
    animations: {
      type: string;
      config: {
        bottom?: boolean;
        top?: boolean;
        count?: number;
        cubeHeight?: number;
        lineWidth?: number;
        diameter?: number;
        fillColor?: string | WaveColor;
        lineColor?: string | WaveColor;
        radius?: number;
        frequencyBand?: string;
      };
    }[];
  };
};

export default createPlugin({
  name: () => t('plugins.visualizer.name'),
  description: () => t('plugins.visualizer.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    type: 'butterchurn',
    // Config per visualizer
    butterchurn: {
      preset: 'martin [shadow harlequins shape code] - fata morgana',
      renderingFrequencyInMs: 500,
      blendTimeInSeconds: 2.7,
    },
    vudio: {
      effect: 'lighting',
      accuracy: 128,
      lighting: {
        maxHeight: 160,
        maxSize: 12,
        lineWidth: 1,
        color: '#49f3f7',
        shadowBlur: 2,
        shadowColor: 'rgba(244,244,244,.5)',
        fadeSide: true,
        prettify: false,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        dottify: true,
      },
    },
    wave: {
      animations: [
        {
          type: 'Cubes',
          config: {
            bottom: true,
            count: 30,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 20,
          },
        },
        {
          type: 'Cubes',
          config: {
            top: true,
            count: 12,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 10,
          },
        },
        {
          type: 'Circles',
          config: {
            lineColor: {
              gradient: ['#FAD961', '#FAD961', '#F76B1C'],
              rotate: 90,
            },
            lineWidth: 4,
            diameter: 20,
            count: 10,
            frequencyBand: 'base',
          },
        },
      ],
    },
  } as VisualizerPluginConfig,
  stylesheets: [emptyStyle],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const visualizerTypes = ['butterchurn', 'vudio', 'wave'] as const; // For bundling

    return [
      {
        label: t('plugins.visualizer.menu.visualizer-type'),
        submenu: visualizerTypes.map((visualizerType) => ({
          label: visualizerType,
          type: 'radio',
          checked: config.type === visualizerType,
          click() {
            setConfig({ type: visualizerType });
          },
        })),
      },
    ];
  },

  renderer: {
    async onPlayerApiReady(_, { getConfig }) {
      const config = await getConfig();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let visualizerType: { new (...args: any[]): Visualizer<unknown> } = vudio;

      if (config.type === 'wave') {
        visualizerType = wave;
      } else if (config.type === 'butterchurn') {
        visualizerType = butterchurn;
      }

      document.addEventListener(
        'peard:audio-can-play',
        (e) => {
          const video = document.querySelector<
            HTMLVideoElement & { captureStream(): MediaStream }
          >('video');
          if (!video) {
            return;
          }

          const visualizerContainer =
            document.querySelector<HTMLElement>('#player');
          if (!visualizerContainer) {
            return;
          }

          let canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'visualizer';
            visualizerContainer?.prepend(canvas);
          }

          const resizeCanvas = () => {
            if (canvas) {
              canvas.width = visualizerContainer.clientWidth;
              canvas.height = visualizerContainer.clientHeight;
            }
          };

          resizeCanvas();

          const gainNode = e.detail.audioContext.createGain();
          gainNode.gain.value = 1.25;
          e.detail.audioSource.connect(gainNode);

          const visualizer = new visualizerType(
            e.detail.audioContext,
            e.detail.audioSource,
            visualizerContainer,
            canvas,
            gainNode,
            video.captureStream(),
            config,
          );

          const resizeVisualizer = (width: number, height: number) => {
            resizeCanvas();
            visualizer.resize(width, height);
          };

          resizeVisualizer(canvas.width, canvas.height);
          const visualizerContainerObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              resizeVisualizer(
                entry.contentRect.width,
                entry.contentRect.height,
              );
            }
          });
          visualizerContainerObserver.observe(visualizerContainer);

          visualizer.render();
        },
        { passive: true },
      );
    },
  },
});
