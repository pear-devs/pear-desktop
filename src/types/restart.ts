export type RestartRequirement =
  | { type: 'plugin'; id: string }
  | { type: 'setting'; label: string };
