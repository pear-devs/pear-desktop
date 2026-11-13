import type { ConfigShape } from '@/plugins/utils/common/config';
import type {
  BackendPart,
  Empty,
  IpcShape,
  PluginDef,
  PreloadPart,
  RendererPart,
} from '@/types/plugins';

export const LoggerPrefix = '[YTMusic]';

/**
 * Defines a plugin. Must be the file's default export as
 * `export default createPlugin({...})`: the build strips the parts other
 * processes don't need from that object literal.
 */
export const createPlugin = <
  const S extends ConfigShape = Empty,
  I extends IpcShape = Empty,
>(
  def: PluginDef<S, I>,
) => def;

/** A backend part in its own file: `createBackend<typeof config, Ipc>((ctx) => …)`. */
export const createBackend = <
  S extends ConfigShape = Empty,
  I extends IpcShape = Empty,
>(
  part: BackendPart<S, I>,
) => part;

export const createPreload = <S extends ConfigShape = Empty>(
  part: PreloadPart<S>,
) => part;

export const createRenderer = <
  S extends ConfigShape = Empty,
  I extends IpcShape = Empty,
>(
  part: RendererPart<S, I>,
) => part;
