import { For } from 'solid-js';

import { t } from '@/i18n';

import { defaultPresets } from './presets';

import type { CustomFieldContext } from '@/types/settings';

export const EqualizerPresets = (props: { ctx: CustomFieldContext }) => {
  const isOn = (preset: string) =>
    Boolean(props.ctx.getValue(`presets.${preset}`));

  return (
    <div class="sui-chips">
      <For each={defaultPresets}>
        {(preset) => (
          <button
            class="sui-chip"
            classList={{ 'sui-chip--selected': isOn(preset) }}
            onClick={() =>
              props.ctx.setValue(`presets.${preset}`, !isOn(preset))
            }
            type="button"
          >
            {t(`plugins.equalizer.menu.presets.list.${preset}`)}
          </button>
        )}
      </For>
    </div>
  );
};
