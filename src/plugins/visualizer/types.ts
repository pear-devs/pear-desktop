import { config, type ConfigOf } from '@/plugins/utils/common/config';

type WaveColor = {
  gradient: string[];
  rotate?: number;
};

export const visualizerConfig = {
  type: config.select(
    'butterchurn',
    [{ value: 'butterchurn' }, { value: 'vudio' }, { value: 'wave' }],
    { label: 'plugins.visualizer.menu.visualizer-type' },
  ),
  // Config per visualizer (edited in config.json only)
  butterchurn: config.hidden({
    preset: 'martin [shadow harlequins shape code] - fata morgana',
    blendTimeInSeconds: 2.7,
  }),
  vudio: config.hidden({
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
  }),
  wave: config.hidden<{
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
  }>({
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
  }),
};

export type VisualizerPluginConfig = ConfigOf<typeof visualizerConfig>;
