import { Show, Switch as SwitchFlow, Match } from 'solid-js';

import { t } from '@/i18n';

import {
  CheckGroup,
  Dropdown,
  RadioGroup,
  Slider,
  Switch,
  TextInput,
} from './Controls';

import type { SettingField } from '@/types/settings';

export interface SettingsFieldProps {
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
  onSliderChange?: (value: unknown) => void;
}

export const SettingsField = (props: SettingsFieldProps) => {
  const field = () => props.field;

  return (
    <div class="sui-field">
      <div class="sui-field__row">
        <div class="sui-field__text">
          <div class="sui-field__label-line">
            <span class="sui-field__label">{field().label()}</span>
            <Show when={field().restartNeeded}>
              <span class="sui-pill" title={t('settings-ui.restart-pill-hint')}>
                {t('settings-ui.restart-pill')}
              </span>
            </Show>
          </div>
          <Show when={field().description}>
            <div class="sui-field__desc">{field().description!()}</div>
          </Show>
        </div>

        <Show when={field().type === 'switch'}>
          <Switch
            checked={Boolean(props.value)}
            onChange={(v) => props.onChange(v)}
          />
        </Show>
      </div>

      <SwitchFlow>
        <Match when={field().type === 'select'}>
          {(() => {
            const f = field() as Extract<SettingField, { type: 'select' }>;
            return (
              <div class="sui-field__control">
                <Show
                  fallback={
                    <RadioGroup
                      onChange={(v) => props.onChange(v)}
                      options={f.options}
                      value={(props.value as string | undefined) ?? ''}
                    />
                  }
                  when={f.variant === 'dropdown'}
                >
                  <Dropdown
                    onChange={(v) => props.onChange(v)}
                    options={f.options}
                    value={(props.value as string | undefined) ?? ''}
                  />
                </Show>
              </div>
            );
          })()}
        </Match>

        <Match when={field().type === 'slider'}>
          {(() => {
            const f = field() as Extract<SettingField, { type: 'slider' }>;
            const scale = f.scale ?? 1;
            const shown = () => Number(props.value ?? f.min) / scale;
            return (
              <div class="sui-field__control">
                <Slider
                  display={`${shown()}${f.unit ? ' ' + f.unit : ''}`}
                  max={f.max}
                  min={f.min}
                  onInput={(v) =>
                    (props.onSliderChange ?? props.onChange)(v * scale)
                  }
                  step={f.step}
                  value={shown()}
                />
              </div>
            );
          })()}
        </Match>

        <Match when={field().type === 'text'}>
          {(() => {
            const f = field() as Extract<SettingField, { type: 'text' }>;
            return (
              <div class="sui-field__control">
                <TextInput
                  onChange={(v) => props.onChange(v)}
                  placeholder={f.placeholder?.()}
                  value={(props.value as string | undefined) ?? ''}
                />
              </div>
            );
          })()}
        </Match>

        <Match when={field().type === 'multiselect'}>
          {(() => {
            const f = field() as Extract<SettingField, { type: 'multiselect' }>;
            return (
              <div class="sui-field__control">
                <CheckGroup
                  onChange={(v) => props.onChange(v)}
                  options={f.options}
                  values={
                    Array.isArray(props.value) ? (props.value as string[]) : []
                  }
                />
              </div>
            );
          })()}
        </Match>
      </SwitchFlow>
    </div>
  );
};
