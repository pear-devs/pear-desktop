import { For, Show, type Component } from 'solid-js';

import { t } from '@/i18n';

import { Switch } from './Controls';
import { Icon } from './Icon';
import { SettingsField } from './SettingsField';

import type { CustomFieldContext, SettingsGroup } from '@/types/settings';

export interface PluginCardProps {
  name: string;
  description?: string;
  restartNeeded?: boolean;
  enabled: boolean;
  hasSettings: boolean;
  expanded: boolean;
  groups: SettingsGroup[];
  onToggle: (enabled: boolean) => void;
  onExpand: () => void;
  getValue: (key: string) => unknown;
  setValue: (key: string, value: unknown) => void;
  setSliderValue: (key: string, value: unknown) => void;
  resolveComponent?: (
    id: string,
  ) => Component<{ ctx: CustomFieldContext }> | undefined;
}

export const PluginCard = (props: PluginCardProps) => (
  <div class="sui-card">
    <div
      aria-expanded={props.hasSettings ? props.expanded : undefined}
      class="sui-card__head"
      classList={{ 'sui-card__head--clickable': props.hasSettings }}
      onClick={() => props.hasSettings && props.onExpand()}
      onKeyDown={(e) => {
        if (props.hasSettings && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          props.onExpand();
        }
      }}
      role={props.hasSettings ? 'button' : undefined}
      tabindex={props.hasSettings ? 0 : undefined}
    >
      <div class="sui-field__text">
        <div class="sui-field__label-line">
          <span class="sui-field__label">{props.name}</span>
          <Show when={props.restartNeeded}>
            <span class="sui-pill" title={t('settings-ui.restart-pill-hint')}>
              {t('settings-ui.restart-pill')}
            </span>
          </Show>
        </div>
        <Show when={props.description}>
          <div class="sui-field__desc">{props.description}</div>
        </Show>
      </div>

      <Show when={props.hasSettings}>
        <span class="sui-card__chevron">
          <Icon name={props.expanded ? 'chevronDown' : 'chevronRight'} />
        </span>
      </Show>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'inline-flex' }}
      >
        <Switch
          checked={props.enabled}
          label={props.name}
          onChange={(v) => props.onToggle(v)}
        />
      </div>
    </div>

    <Show when={props.hasSettings && props.expanded}>
      <div class="sui-card__body">
        <For each={props.groups}>
          {(group) => (
            <For each={group.fields}>
              {(field) => (
                <SettingsField
                  accessors={{
                    getValue: props.getValue,
                    setValue: props.setValue,
                    setSliderValue: props.setSliderValue,
                  }}
                  field={field}
                  onChange={(v) => props.setValue(field.key, v)}
                  onSliderChange={(v) => props.setSliderValue(field.key, v)}
                  resolveComponent={props.resolveComponent}
                  value={props.getValue(field.key)}
                />
              )}
            </For>
          )}
        </For>
      </div>
    </Show>
  </div>
);
