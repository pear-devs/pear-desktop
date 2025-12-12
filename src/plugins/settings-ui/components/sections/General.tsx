import { t } from '@/i18n';

import { Select } from '../Select';
import { Toggle } from '../Toggle';

export const General = () => {
  const t$ = (key: string) => t(`main.menu.options.submenu.${key}`);

  return (
    <>
      {/* <Show
        when={
          props.platform.startsWith('Windows') ||
          props.platform.startsWith('macOS')
        }
      > */}
      <Toggle
        description="Start Pear Music on login"
        label={t$('start-at-login')}
        toggle={() => {}}
        value={true}
      />
      {/* </Show> */}

      <Select
        description="Select the language for the application"
        label={t$('language.label')}
        onSelect={() => {}}
        options={[
          // mock data
          { value: 'en', label: 'English' },
          { value: 'gr', label: 'Ελληνικά' },
        ]}
        value="en"
      />

      <Select
        description="Select which page to show when the application starts"
        label={t$('starting-page.label')}
        onSelect={() => {}}
        options={[]}
        value={''}
      />

      <Toggle
        description="Automatically get notified about new versions"
        label={t$('auto-update')}
        toggle={() => {}}
        value={true}
      />

      <Toggle
        description="Resume last song when app starts"
        label={t$('resume-on-start')}
        toggle={() => {}}
        value={true}
      />

      <Toggle
        description="Keep the application window on top of other windows"
        label={t$('always-on-top')}
        toggle={() => {}}
        value={false}
      />

      {/* <Show
        when={
          props.platform.startsWith('Windows') ||
          props.platform.startsWith('Linux')
        }
      > */}
      <Toggle
        description="Hide the menu bar"
        label={t$('hide-menu.label')}
        toggle={() => {}}
        value={false}
      />
      {/* </Show> */}
    </>
  );
};
