import {
  createResource,
  createSignal,
  Show,
  Switch as SwitchFlow,
  Match,
  type Component,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { t } from '@/i18n';

import {
  CheckGroup,
  Dropdown,
  NumberStepper,
  RadioGroup,
  Slider,
  Switch,
  TextInput,
} from './Controls';
import { Icon } from './Icon';

import { pickDirectory, pickFile } from '../state';

import type {
  ActionField,
  CustomField,
  CustomFieldContext,
  FieldAccessors,
  NumberField,
  SelectField,
  SettingField,
  SettingOptions,
} from '@/types/settings';

export interface SettingsFieldProps {
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
  onSliderChange?: (value: unknown) => void;
  accessors?: FieldAccessors;
  /** Resolve a `"<pluginId>.<name>"` custom component. */
  resolveComponent?: (
    id: string,
  ) => Component<{ ctx: CustomFieldContext }> | undefined;
}

// Resolve static or async option providers once per field.
const useResolvedOptions = (getOptions: () => SettingOptions) => {
  const [options, { refetch }] = createResource(
    getOptions,
    async (opts) => (typeof opts === 'function' ? await opts() : opts),
    { initialValue: [] },
  );
  return { options, refetch };
};

const SPIN_MIN_MS = 500;
const RefreshButton = (p: { onRefresh: () => unknown }) => {
  const [spinning, setSpinning] = createSignal(false);
  const run = async () => {
    if (spinning()) return;
    setSpinning(true);
    try {
      await Promise.all([
        Promise.resolve(p.onRefresh()),
        new Promise((resolve) => setTimeout(resolve, SPIN_MIN_MS)),
      ]);
    } finally {
      setSpinning(false);
    }
  };
  return (
    <button
      aria-label={t('settings-ui.refresh-options')}
      class="sui-refreshbtn"
      classList={{ 'sui-refreshbtn--spin': spinning() }}
      onClick={() => {
        run();
      }}
      title={t('settings-ui.refresh-options')}
      type="button"
    >
      <Icon name="refresh" size={18} />
    </button>
  );
};

const SelectControl = (p: {
  field: SelectField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const { options, refetch } = useResolvedOptions(() => p.field.options);
  const isDynamic = () => typeof p.field.options === 'function';
  const value = () => (p.value as string | number | undefined) ?? '';
  return (
    <div class="sui-field__control">
      <div class="sui-control-row">
        <Show
          fallback={
            <RadioGroup
              onChange={(v) => p.onChange(v)}
              options={options()}
              value={value()}
            />
          }
          when={p.field.variant === 'dropdown'}
        >
          <Dropdown
            onChange={(v) => p.onChange(v)}
            options={options()}
            value={value()}
          />
        </Show>
        <Show when={isDynamic()}>
          <RefreshButton onRefresh={() => refetch()} />
        </Show>
      </div>
    </div>
  );
};

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
          <SelectControl
            field={field() as SelectField}
            onChange={props.onChange}
            value={props.value}
          />
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

        <Match when={field().type === 'number'}>
          {(() => {
            const f = field() as NumberField;
            return (
              <div class="sui-field__control">
                <NumberStepper
                  max={f.max}
                  min={f.min}
                  onChange={(v) => props.onChange(v)}
                  step={f.step}
                  unit={f.unit}
                  value={Number(props.value ?? f.min ?? 0)}
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
              <MultiSelectControl
                field={f}
                onChange={props.onChange}
                value={props.value}
              />
            );
          })()}
        </Match>

        <Match when={field().type === 'action'}>
          {(() => {
            const f = field() as ActionField;
            return (
              <div class="sui-field__control">
                <button
                  class="sui-fieldbtn"
                  onClick={() =>
                    props.accessors &&
                    f.onClick({
                      ...props.accessors,
                      pickDirectory,
                      pickFile,
                    })
                  }
                  type="button"
                >
                  {f.buttonLabel()}
                </button>
              </div>
            );
          })()}
        </Match>

        <Match when={field().type === 'custom'}>
          {(() => {
            const f = field() as CustomField;
            const comp = props.resolveComponent?.(f.component);
            const accessors = props.accessors;
            return (
              <div class="sui-field__control">
                <Show
                  fallback={
                    <div class="sui-field__desc">
                      missing component: {f.component}
                    </div>
                  }
                  when={comp && accessors ? { comp, accessors } : null}
                >
                  {(bound) => (
                    <Dynamic component={bound().comp} ctx={bound().accessors} />
                  )}
                </Show>
              </div>
            );
          })()}
        </Match>
      </SwitchFlow>
    </div>
  );
};

const MultiSelectControl = (p: {
  field: Extract<SettingField, { type: 'multiselect' }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const { options, refetch } = useResolvedOptions(() => p.field.options);
  const isDynamic = () => typeof p.field.options === 'function';
  return (
    <div class="sui-field__control">
      <div class="sui-control-row">
        <CheckGroup
          onChange={(v) => p.onChange(v)}
          options={options()}
          values={
            Array.isArray(p.value) ? (p.value as (string | number)[]) : []
          }
        />
        <Show when={isDynamic()}>
          <RefreshButton onRefresh={() => refetch()} />
        </Show>
      </div>
    </div>
  );
};
