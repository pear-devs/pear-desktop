import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { allPlugins } from 'virtual:plugins';

import { t } from '@/i18n';
import { toSettingsGroups, type SettingsGroup } from '@/types/settings';

import { Icon } from './Icon';
import { PluginCard } from './PluginCard';
import { SettingsField } from './SettingsField';

import { buildAppSections } from '../schema/app-settings';
import {
  bridge,
  flushPendingPluginSliderWrites,
  getAppValue,
  getByPath,
  getPluginConfig,
  setAppValue,
  setPluginValue,
  setPluginSliderValue,
  store,
} from '../state';

import type { RestartRequirement } from '@/types/restart';

interface PluginMeta {
  id: string;
  name: string;
  description?: string;
  restartNeeded: boolean;
  config: Record<string, unknown>;
  groups: SettingsGroup[];
  hasSettings: boolean;
}

const matches = (query: string, ...parts: (string | undefined)[]) =>
  parts.filter(Boolean).some((p) => p.toLowerCase().includes(query));

const restartRequirementKey = (requirement: RestartRequirement) =>
  requirement.type === 'plugin'
    ? `plugin:${requirement.id}`
    : `setting:${requirement.label}`;

export const SettingsModal = (props: { onClose: () => void }) => {
  const [active, setActive] = createSignal<string>('general');
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [restartFlagged, setRestartFlagged] = createSignal(false);
  const [restartRequirements, setRestartRequirements] = createSignal<
    RestartRequirement[]
  >([]);
  let isClosing = false;

  const [appSections] = createResource(buildAppSections);
  const [appMeta] = createResource(() => bridge.appMeta());
  const [plugins] = createResource<PluginMeta[]>(async () => {
    const stubs = await allPlugins();
    return Object.entries(stubs)
      .filter(([id]) => id !== 'settings-ui')
      .map(([id, def]) => {
        const groups = def.settings ? toSettingsGroups(def.settings) : [];
        return {
          id,
          name: def.name?.() ?? id,
          description: def.description?.(),
          restartNeeded: Boolean(def.restartNeeded),
          config: (def.config ?? { enabled: false }) as Record<string, unknown>,
          groups,
          hasSettings: groups.length > 0,
        } satisfies PluginMeta;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  onMount(() => {
    bridge.restartSessionOpen();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const enabledCount = createMemo(() => {
    const list = plugins() ?? [];
    const snap = store();
    if (!snap) return 0;
    return list.filter(
      (p) =>
        (snap.plugins as Record<string, { enabled?: boolean }>)[p.id]
          ?.enabled ?? (p.config.enabled as boolean),
    ).length;
  });

  const flagIfRestart = (
    requirement: RestartRequirement,
    needsRestart?: boolean,
  ) => {
    if (!needsRestart) return;

    setRestartFlagged(true);
    setRestartRequirements((current) =>
      current.some(
        (item) =>
          restartRequirementKey(item) === restartRequirementKey(requirement),
      )
        ? current
        : [...current, requirement],
    );
  };

  const close = () => {
    if (isClosing) return;
    isClosing = true;

    const requirements = restartRequirements();
    props.onClose();
    flushPendingPluginSliderWrites().finally(() =>
      bridge.restartSessionClose(requirements),
    );
  };

  // ---- app-option value plumbing ----
  const appVal = (key: string) => {
    const snap = store();
    return snap ? getAppValue(snap, key) : undefined;
  };
  const appSet = (
    key: string,
    value: unknown,
    label: string,
    needsRestart?: boolean,
  ) => {
    setAppValue(key, value);
    flagIfRestart({ type: 'setting', label }, needsRestart);
  };

  // ---- plugin value plumbing ----
  const pluginVal = (meta: PluginMeta, key: string) => {
    const snap = store();
    if (!snap) return undefined;
    return getByPath(getPluginConfig(snap, meta.id, meta.config), key);
  };
  const pluginEnabled = (meta: PluginMeta) => {
    const snap = store();
    const stored = snap
      ? (snap.plugins as Record<string, { enabled?: boolean }>)[meta.id]
      : undefined;
    return stored?.enabled ?? (meta.config.enabled as boolean);
  };
  const togglePlugin = (meta: PluginMeta, value: boolean) => {
    bridge.pluginToggle(meta.id, value);
    flagIfRestart({ type: 'plugin', id: meta.id }, meta.restartNeeded);
  };

  const sections = () => appSections() ?? [];
  const currentSection = () => sections().find((s) => s.id === active());

  const isSearching = () => query().trim().length > 0;

  const headerTitle = () => {
    if (isSearching()) return t('settings-ui.search-results');
    if (active() === 'plugins') return t('settings-ui.sections.plugins.label');
    return currentSection()?.label() ?? '';
  };
  const headerSub = () => {
    if (isSearching())
      return t('settings-ui.search-matching', { query: query().trim() });
    if (active() === 'plugins') return t('settings-ui.sections.plugins.sub');
    return currentSection()?.sub() ?? '';
  };

  // ---- search result computation ----
  const searchAppGroups = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return [] as { title: string; group: SettingsGroup }[];
    const out: { title: string; group: SettingsGroup }[] = [];
    for (const section of sections()) {
      for (const group of section.groups) {
        const fields = group.fields.filter((f) =>
          matches(q, f.label(), f.description?.()),
        );
        if (fields.length)
          out.push({
            title: `${section.label()} · ${group.title?.() ?? ''}`,
            group: { fields },
          });
      }
    }
    return out;
  });

  const searchPlugins = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return [] as { meta: PluginMeta; groups: SettingsGroup[] }[];
    const out: { meta: PluginMeta; groups: SettingsGroup[] }[] = [];
    for (const meta of plugins() ?? []) {
      const nameHit = matches(q, meta.name, meta.description);
      if (nameHit) {
        out.push({ meta, groups: meta.groups });
        continue;
      }
      const groups = meta.groups
        .map((g) => ({
          ...g,
          fields: g.fields.filter((f) =>
            matches(q, f.label(), f.description?.()),
          ),
        }))
        .filter((g) => g.fields.length);
      if (groups.length) out.push({ meta, groups });
    }
    return out;
  });

  const searchEmpty = () =>
    isSearching() &&
    searchAppGroups().length === 0 &&
    searchPlugins().length === 0;

  const AppGroupView = (p: {
    title?: string;
    group: SettingsGroup;
    sectionId?: string;
  }) => (
    <div class="sui-group">
      <Show when={p.title}>
        <div class="sui-group__title">{p.title}</div>
      </Show>
      <div class="sui-group__card">
        <For each={p.group.fields}>
          {(field) => (
            <SettingsField
              field={field}
              onChange={(v) =>
                appSet(field.key, v, field.label(), field.restartNeeded)
              }
              value={appVal(field.key)}
            />
          )}
        </For>
      </div>
    </div>
  );

  return (
    <div class="sui-root">
      <div class="sui-scrim" onClick={close} />

      <div aria-modal="true" class="sui-modal" role="dialog">
        {/* sidebar */}
        <aside class="sui-sidebar">
          <div class="sui-sidebar__head">
            <div class="sui-sidebar__title">{t('settings-ui.title')}</div>
            <div class="sui-sidebar__subtitle">{t('settings-ui.subtitle')}</div>
          </div>

          <div class="sui-search">
            <Icon name="search" size={20} />
            <input
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder={t('settings-ui.search-placeholder')}
              type="text"
              value={query()}
            />
          </div>

          <nav class="sui-nav">
            <For each={sections()}>
              {(section) => (
                <button
                  class="sui-nav__item"
                  classList={{
                    'sui-nav__item--active':
                      !isSearching() && active() === section.id,
                  }}
                  onClick={() => {
                    setActive(section.id);
                    setQuery('');
                    setExpanded(null);
                  }}
                  type="button"
                >
                  <Icon name={section.icon} size={20} />
                  <span>{section.label()}</span>
                </button>
              )}
            </For>
            <button
              class="sui-nav__item"
              classList={{
                'sui-nav__item--active':
                  !isSearching() && active() === 'plugins',
              }}
              onClick={() => {
                setActive('plugins');
                setQuery('');
                setExpanded(null);
              }}
              type="button"
            >
              <Icon name="puzzle" size={20} />
              <span>{t('settings-ui.sections.plugins.label')}</span>
              <span class="sui-nav__count">
                {enabledCount()}/{(plugins() ?? []).length}
              </span>
            </button>
          </nav>

          <div class="sui-sidebar__foot">
            <span>v{appMeta()?.version ?? ''}</span>
            <a
              href="#"
              onClick={(e) => (e.preventDefault(), bridge.configEdit())}
            >
              {t('settings-ui.edit-config')}
            </a>
          </div>
        </aside>

        {/* main */}
        <section class="sui-main">
          <header class="sui-header">
            <div class="sui-header__text">
              <div class="sui-header__title">{headerTitle()}</div>
              <div class="sui-header__sub">{headerSub()}</div>
            </div>
            <button
              aria-label={t('settings-ui.close')}
              class="sui-iconbtn"
              onClick={close}
              type="button"
            >
              <Icon name="close" size={22} />
            </button>
          </header>

          <Show when={restartFlagged()}>
            <div class="sui-restart">
              <Icon name="schedule" size={20} />
              <span class="sui-restart__text">
                {t('settings-ui.restart-banner')}
              </span>
              <button
                class="sui-restart__later"
                onClick={() => setRestartFlagged(false)}
                type="button"
              >
                {t('settings-ui.later')}
              </button>
              <button
                class="sui-restart__now"
                onClick={() => bridge.restart()}
                type="button"
              >
                {t('settings-ui.restart-now')}
              </button>
            </div>
          </Show>

          <div class="sui-body">
            <Show fallback={<div class="sui-empty">…</div>} when={store()}>
              {/* search mode */}
              <Show when={isSearching()}>
                <Show when={searchEmpty()}>
                  <div class="sui-empty">
                    {t('settings-ui.no-match', { query: query().trim() })}
                  </div>
                </Show>
                <For each={searchAppGroups()}>
                  {(block) => (
                    <AppGroupView group={block.group} title={block.title} />
                  )}
                </For>
                <For each={searchPlugins()}>
                  {(block) => (
                    <PluginCard
                      description={block.meta.description}
                      enabled={pluginEnabled(block.meta)}
                      expanded={block.groups.length > 0}
                      getValue={(key) => pluginVal(block.meta, key)}
                      groups={block.groups}
                      hasSettings={block.groups.length > 0}
                      name={block.meta.name}
                      onExpand={() => {}}
                      onToggle={(v) => togglePlugin(block.meta, v)}
                      restartNeeded={block.meta.restartNeeded}
                      setSliderValue={(key, v) => {
                        setPluginSliderValue(block.meta.id, key, v);
                        flagIfRestart(
                          { type: 'plugin', id: block.meta.id },
                          block.meta.restartNeeded,
                        );
                      }}
                      setValue={(key, v) => {
                        setPluginValue(block.meta.id, key, v);
                        flagIfRestart(
                          { type: 'plugin', id: block.meta.id },
                          block.meta.restartNeeded,
                        );
                      }}
                    />
                  )}
                </For>
              </Show>

              {/* section mode */}
              <Show when={!isSearching()}>
                <Show when={active() === 'plugins'}>
                  <For each={plugins()}>
                    {(meta) => (
                      <PluginCard
                        description={meta.description}
                        enabled={pluginEnabled(meta)}
                        expanded={expanded() === meta.id}
                        getValue={(key) => pluginVal(meta, key)}
                        groups={meta.groups}
                        hasSettings={meta.hasSettings}
                        name={meta.name}
                        onExpand={() =>
                          setExpanded((cur) =>
                            cur === meta.id ? null : meta.id,
                          )
                        }
                        onToggle={(v) => togglePlugin(meta, v)}
                        restartNeeded={meta.restartNeeded}
                        setSliderValue={(key, v) => {
                          setPluginSliderValue(meta.id, key, v);
                          flagIfRestart(
                            { type: 'plugin', id: meta.id },
                            meta.restartNeeded,
                          );
                        }}
                        setValue={(key, v) => {
                          setPluginValue(meta.id, key, v);
                          flagIfRestart(
                            { type: 'plugin', id: meta.id },
                            meta.restartNeeded,
                          );
                        }}
                      />
                    )}
                  </For>
                </Show>

                <Show when={active() !== 'plugins'}>
                  <For each={currentSection()?.groups ?? []}>
                    {(group) => (
                      <AppGroupView group={group} title={group.title?.()} />
                    )}
                  </For>
                  <Show when={active() === 'advanced'}>
                    <div class="sui-actions">
                      <button
                        class="sui-outlinedbtn"
                        onClick={() => bridge.toggleDevTools()}
                        type="button"
                      >
                        {t(
                          'main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools',
                        )}
                      </button>
                      <button
                        class="sui-outlinedbtn"
                        onClick={() => bridge.configEdit()}
                        type="button"
                      >
                        {t('settings-ui.edit-config')}
                      </button>
                    </div>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </section>
      </div>
    </div>
  );
};
