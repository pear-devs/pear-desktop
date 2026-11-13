import { createContext, useContext } from 'solid-js';

import type { InAppMenuIpc } from '../types';
import type { RendererIpc } from '@/types/contexts';

export type InAppMenuRendererIpc = RendererIpc<InAppMenuIpc>;

/** The plugin's IPC, for the title bar's components. */
export const IpcContext = createContext<InAppMenuRendererIpc>();

export const useIpc = () => {
  const ipc = useContext(IpcContext);
  if (!ipc) throw new Error('[in-app-menu] IpcContext is missing');
  return ipc;
};
