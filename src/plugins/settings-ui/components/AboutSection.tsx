import { createSignal, For, Show } from 'solid-js';

import { t } from '@/i18n';

import { Icon } from './Icon';

import iconSvg from '../../../../assets/icon.svg?raw';
import { bridge, type AppMeta } from '../state';

const ICON_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`;

const REPO = 'https://github.com/pear-devs/pear-desktop';

interface LinkDef {
  icon: 'github' | 'external';
  label: string;
  url: string;
}

const osOptionLabel = (platform: string) => {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Other Linux';
  return 'Other (specify below)';
};
const archOptionLabel = (arch: string) => {
  if (arch === 'x64') return 'x64';
  if (arch === 'ia32') return 'ia32';
  if (arch === 'arm64') return 'arm64 (including Apple Silicon)';
  return 'Other (specify below)';
};

export const AboutSection = (props: {
  meta?: AppMeta;
  enabledPlugins?: string[];
}) => {
  const meta = () => props.meta;
  const [copied, setCopied] = createSignal(false);

  const reportIssueUrl = () => {
    const m = meta();
    const params = new URLSearchParams({ template: 'bug_report.yml' });
    if (m) {
      params.set('app-version', m.version);
      params.set('os', osOptionLabel(m.platform));
      params.set('os-version', m.osVersion);
      params.set('cpu-arch', archOptionLabel(m.arch));
    }
    const plugins = props.enabledPlugins ?? [];
    if (plugins.length) {
      params.set(
        'enabled-plugins',
        plugins.map((name, i) => `${i + 1}. ${name}`).join('\n'),
      );
    }
    return `${REPO}/issues/new?${params.toString()}`;
  };

  const versionRows = () => {
    const m = meta();
    return [
      {
        label: t('settings-ui.about.version-app'),
        value: m ? `v${m.version}` : '…',
      },
      {
        label: t('settings-ui.about.version-electron'),
        value: m?.versions.electron ?? '…',
      },
      {
        label: t('settings-ui.about.version-chromium'),
        value: m?.versions.chrome ?? '…',
      },
      {
        label: t('settings-ui.about.version-node'),
        value: m?.versions.node ?? '…',
      },
      {
        label: t('settings-ui.about.version-platform'),
        value: m ? `${m.platform} (${m.arch})` : '…',
      },
    ];
  };

  const links = (): LinkDef[] => [
    { icon: 'github', label: t('settings-ui.about.link-repo'), url: REPO },
    {
      icon: 'external',
      label: t('settings-ui.about.link-issue'),
      url: reportIssueUrl(),
    },
    {
      icon: 'external',
      label: t('settings-ui.about.link-releases'),
      url: `${REPO}/releases`,
    },
    {
      icon: 'external',
      label: t('settings-ui.about.link-license'),
      url: `${REPO}/blob/master/license`,
    },
  ];

  const debugInfo = () => {
    const m = meta();
    if (!m) return '';
    return [
      `${m.name} v${m.version}`,
      `Platform: ${m.platform} (${m.arch})`,
      `Electron: ${m.versions.electron}`,
      `Chromium: ${m.versions.chrome}`,
      `Node: ${m.versions.node}`,
    ].join('\n');
  };

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(debugInfo());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div class="sui-about">
      <div class="sui-about__header">
        <img alt="" class="sui-about__logo" src={ICON_SRC} />
        <div class="sui-about__name">Pear Desktop</div>
        <Show when={meta()}>
          <div class="sui-about__version">v{meta()!.version}</div>
        </Show>
        <div class="sui-about__tagline">{t('settings-ui.about.tagline')}</div>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.versions')}
        </div>
        <dl class="sui-about__grid">
          <For each={versionRows()}>
            {(row) => (
              <div class="sui-about__grid-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.links')}
        </div>
        <div class="sui-about__links">
          <For each={links()}>
            {(link) => (
              <button
                class="sui-outlinedbtn sui-about__link"
                onClick={() => bridge.openExternal(link.url)}
                type="button"
              >
                <Icon name={link.icon} size={18} />
                <span>{link.label}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.actions')}
        </div>
        <div class="sui-actions">
          <button
            class="sui-outlinedbtn"
            onClick={() => bridge.checkUpdates()}
            type="button"
          >
            {t('settings-ui.about.check-updates')}
          </button>
          <button
            class="sui-outlinedbtn"
            onClick={() => {
              copyDebug();
            }}
            type="button"
          >
            {copied()
              ? t('settings-ui.about.copied')
              : t('settings-ui.about.copy-debug')}
          </button>
        </div>
      </div>
    </div>
  );
};
