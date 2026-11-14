// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
export type CastSessionSnapshot = {
  handle: string;
  sessionId: string;
  appId: string;
  displayName: string;
  status: 'connected' | 'disconnected' | 'stopped';
  statusText: string | null;
  namespaces: Array<{ name: string }>;
  receiver: { name: string; volume: { level: number; muted: boolean } };
};

export type CastSessionEvent =
  | { type: 'auto-connected'; handle: string; snapshot: CastSessionSnapshot }
  | { type: 'update'; handle: string; snapshot: CastSessionSnapshot }
  | { type: 'stopped'; handle: string }
  | { type: 'message'; handle: string; namespace: string; data: string };
