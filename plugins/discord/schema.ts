import { config } from "@pear/sdk";

export const schema = {
  activityType: config.select(
    "listening",
    [
      { value: "listening", label: "Listening to" },
      { value: "playing", label: "Playing" },
      { value: "watching", label: "Watching" },
    ],
    { label: "Activity type" },
  ),
  statusDisplayType: config.select(
    "details",
    [
      { value: "details", label: "Song title" },
      { value: "state", label: "Artist" },
      { value: "name", label: "App name" },
    ],
    { label: "Status text", description: "What your member-list status shows after the activity type." },
  ),
  playButton: config.bool(true, { label: "“Play on \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music” button" }),
  hideGitHubButton: config.bool(false, { label: "Hide the GitHub button" }),
  hideDurationLeft: config.bool(false, { label: "Hide elapsed and remaining time" }),
  hideWhenPaused: config.bool(false, { label: "Hide while paused" }),
  activityTimeoutEnabled: config.bool(true, {
    label: "Clear after a long pause",
    description: "Remove the activity when playback stays paused.",
  }),
  // Seconds, as pear-desktop's prompt asked for them.
  activityTimeoutSeconds: config.number(600, { label: "Pause timeout", min: 1, max: 14_400, step: 1, unit: "s", variant: "stepper" }),
  autoReconnect: config.bool(true, {
    label: "Keep trying to connect",
    description: "Reconnect automatically when Discord starts or restarts.",
  }),
};
