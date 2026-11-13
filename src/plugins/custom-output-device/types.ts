import { config } from '@/plugins/utils/common/config';

export const customOutputConfig = {
  // Chosen from the devices below in the "Select Device" prompt (see index.ts).
  output: config.string('default'),
  /** The available output devices (id → label), written by the renderer. */
  devices: config.hidden<Record<string, string>>({}),
};
