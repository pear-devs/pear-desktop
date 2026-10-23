import { config } from "@pear/sdk";

export const schema = {
  displayName: config.string("", { label: "Your name", placeholder: "Guest 1234", description: "Shown to others in a session." }),
  // pear-desktop's permissions (it started every session at "playlist").
  defaultPermission: config.select(
    "playlist",
    [
      { value: "host-only", label: "Listen only" },
      { value: "playlist", label: "Change the queue" },
      { value: "all", label: "Full control" },
    ],
    { label: "What guests can do", description: "Default for new sessions; change it any time while hosting." },
  ),
};
