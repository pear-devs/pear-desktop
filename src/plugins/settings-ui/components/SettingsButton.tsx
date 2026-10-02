import { t } from '@/i18n';

import { Icon } from './Icon';

export const SettingsButton = (props: { onClick: () => void }) => (
  <a
    class="ytmd-sui-entry"
    onClick={() => props.onClick()}
    role="button"
    tabindex="0"
    title={t('settings-ui.title')}
  >
    <span class="ytmd-sui-entry__icon">
      <Icon name="settings" size={24} />
    </span>
    <span class="ytmd-sui-entry__title">{t('settings-ui.title')}</span>
  </a>
);
