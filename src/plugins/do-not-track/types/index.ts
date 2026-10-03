export const blockers = {
  Lite: 'Lite',
  Balanced: 'Balanced',
  Strict: 'Strict',
} as const;

const legacyBlockers = {
  InPlayer: 'In player',
  WithBlocklists: 'With blocklists',
  Custom: 'Custom',
} as const;

export const isLegacyCustomBlocker = (blocker: unknown) =>
  blocker === legacyBlockers.WithBlocklists ||
  blocker === legacyBlockers.Custom;

export const normalizeBlocker = (blocker: unknown) => {
  switch (blocker) {
    case blockers.Balanced:
      return blockers.Balanced;
    case blockers.Strict:
      return blockers.Strict;
    case blockers.Lite:
    case legacyBlockers.InPlayer:
    default:
      return blockers.Lite;
  }
};
