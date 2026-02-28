import type { ContextBridge } from 'electron';

export const inject: (contextBridge: ContextBridge) => void;

export const isInjected: () => boolean;
