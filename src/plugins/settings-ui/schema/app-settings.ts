import { languageResources } from "virtual:i18n";

import { t } from "@/i18n";
import { startingPages } from "@/providers/extracted-data";

import type { SettingsGroup } from "@/types/settings";

export type AppSectionId = "general" | "appearance" | "window" | "advanced";

export interface AppSection {
  id: AppSectionId;
  /** Icon id resolved to an inline SVG in the renderer. */
  icon: string;
  label: () => string;
  sub: () => string;
  groups: SettingsGroup[];
}

export const buildAppSections = async (): Promise<AppSection[]> => {
  const langResources = await languageResources();
  const languageOptions = Object.keys(langResources).map((lang) => {
    const meta = langResources[lang].translation.language;
    return {
      value: lang,
      label: () => `${meta?.name ?? lang} (${meta?.["local-name"] ?? lang})`,
    };
  });

  const startingPageOptions = [
    {
      value: "",
      label: () => t("main.menu.options.submenu.starting-page.unset"),
    },
    ...Object.keys(startingPages).map((name) => ({
      value: name,
      label: () => name,
    })),
  ];

  return [
    {
      id: "general",
      icon: "settings",
      label: () => t("settings-ui.sections.general.label"),
      sub: () => t("settings-ui.sections.general.sub"),
      groups: [
        {
          title: () => t("settings-ui.groups.updates-session"),
          fields: [
            {
              type: "switch",
              key: "options.autoUpdates",
              label: () => t("main.menu.options.submenu.auto-update"),
            },
            {
              type: "switch",
              key: "options.resumeOnStart",
              label: () => t("main.menu.options.submenu.resume-on-start"),
            },
          ],
        },
        {
          title: () => t("settings-ui.groups.startup-language"),
          fields: [
            {
              type: "select",
              key: "options.startingPage",
              label: () => t("main.menu.options.submenu.starting-page.label"),
              options: startingPageOptions,
            },
            {
              type: "select",
              variant: "dropdown",
              key: "options.language",
              label: () => t("main.menu.options.submenu.language.label"),
              restartNeeded: true,
              options: languageOptions,
            },
          ],
        },
      ],
    },
    {
      id: "appearance",
      icon: "palette",
      label: () => t("settings-ui.sections.appearance.label"),
      sub: () => t("settings-ui.sections.appearance.sub"),
      groups: [
        {
          title: () => t("settings-ui.groups.interface"),
          fields: [
            {
              type: "switch",
              key: "options.removeUpgradeButton",
              label: () =>
                t(
                  "main.menu.options.submenu.visual-tweaks.submenu.remove-upgrade-button",
                ),
            },
            {
              type: "select",
              key: "options.likeButtons",
              label: () =>
                t(
                  "main.menu.options.submenu.visual-tweaks.submenu.like-buttons.label",
                ),
              options: [
                {
                  value: "",
                  label: () =>
                    t(
                      "main.menu.options.submenu.visual-tweaks.submenu.like-buttons.default",
                    ),
                },
                {
                  value: "force",
                  label: () =>
                    t(
                      "main.menu.options.submenu.visual-tweaks.submenu.like-buttons.force-show",
                    ),
                },
                {
                  value: "hide",
                  label: () =>
                    t(
                      "main.menu.options.submenu.visual-tweaks.submenu.like-buttons.hide",
                    ),
                },
              ],
            },
            {
              type: "switch",
              key: "options.swapLikeButtonsOrder",
              label: () =>
                t(
                  "main.menu.options.submenu.visual-tweaks.submenu.like-buttons.swap",
                ),
            },
          ],
        },
        {
          title: () => t("settings-ui.groups.window-title"),
          fields: [
            {
              type: "text",
              key: "options.customWindowTitle",
              label: () =>
                t(
                  "main.menu.options.submenu.visual-tweaks.submenu.custom-window-title.label",
                ),
            },
          ],
        },
      ],
    },
    {
      id: "window",
      icon: "window",
      label: () => t("settings-ui.sections.window.label"),
      sub: () => t("settings-ui.sections.window.sub"),
      groups: [
        {
          title: () => t("settings-ui.groups.window"),
          fields: [
            {
              type: "switch",
              key: "options.alwaysOnTop",
              label: () => t("main.menu.options.submenu.always-on-top"),
            },
            {
              type: "switch",
              key: "options.hideMenu",
              label: () => t("main.menu.options.submenu.hide-menu.label"),
              restartNeeded: true,
            },
          ],
        },
        {
          title: () => t("settings-ui.groups.system"),
          fields: [
            {
              type: "switch",
              key: "options.startAtLogin",
              label: () => t("main.menu.options.submenu.start-at-login"),
            },
          ],
        },
        {
          title: () => t("main.menu.options.submenu.tray.label"),
          fields: [
            {
              type: "select",
              key: "options.__trayMode",
              label: () => t("main.menu.options.submenu.tray.label"),
              options: [
                {
                  value: "off",
                  label: () =>
                    t("main.menu.options.submenu.tray.submenu.disabled"),
                },
                {
                  value: "show",
                  label: () =>
                    t(
                      "main.menu.options.submenu.tray.submenu.enabled-and-show-app",
                    ),
                },
                {
                  value: "hide",
                  label: () =>
                    t(
                      "main.menu.options.submenu.tray.submenu.enabled-and-hide-app",
                    ),
                },
              ],
            },
            {
              type: "switch",
              key: "options.trayClickPlayPause",
              label: () =>
                t("main.menu.options.submenu.tray.submenu.play-pause-on-click"),
            },
          ],
        },
      ],
    },
    {
      id: "advanced",
      icon: "tune",
      label: () => t("settings-ui.sections.advanced.label"),
      sub: () => t("settings-ui.sections.advanced.sub"),
      groups: [
        {
          title: () => t("settings-ui.groups.network"),
          fields: [
            {
              type: "text",
              key: "options.proxy",
              label: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.set-proxy.label",
                ),
              placeholder: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.set-proxy.prompt.placeholder",
                ),
              restartNeeded: true,
            },
            {
              type: "switch",
              key: "options.overrideUserAgent",
              label: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.override-user-agent",
                ),
              restartNeeded: true,
            },
          ],
        },
        {
          title: () => t("settings-ui.groups.performance"),
          fields: [
            {
              type: "switch",
              key: "options.disableHardwareAcceleration",
              label: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.disable-hardware-acceleration",
                ),
              restartNeeded: true,
            },
            {
              type: "switch",
              key: "options.autoResetAppCache",
              label: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache",
                ),
            },
          ],
        },
        {
          title: () => t("settings-ui.groups.configuration"),
          fields: [
            {
              type: "switch",
              key: "options.restartOnConfigChanges",
              label: () =>
                t(
                  "main.menu.options.submenu.advanced-options.submenu.restart-on-config-changes",
                ),
            },
          ],
        },
      ],
    },
  ];
};
