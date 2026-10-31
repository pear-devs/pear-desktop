import { config } from "@pear/sdk";

export const inAppMenuConfig = {
  windowControls: config.bool(true, {
    label: "Show window buttons",
    description: "Minimize, maximize and close on Linux. Turn off if your window manager provides its own.",
  }),
};
