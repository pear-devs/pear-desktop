import { isSafeCastAppId } from './endpoint';
import { isValidReceiverId } from './receivers';

export type AutoCastSettings = {
  enabled?: boolean;
  autoCastOnStartup?: boolean;
  autoReconnectSuppressed?: boolean;
  lastReceiverId?: string;
  lastAppId?: string;
};

export function savedCastReceiver(
  settings: AutoCastSettings | null | undefined,
): { id: string; appId: string } | null {
  if (
    !isValidReceiverId(settings?.lastReceiverId) ||
    !isSafeCastAppId(settings?.lastAppId)
  )
    return null;
  return { id: settings.lastReceiverId, appId: settings.lastAppId };
}

export function shouldAutoCast(
  settings: AutoCastSettings | null | undefined,
): boolean {
  return (
    settings?.enabled !== false &&
    settings?.autoCastOnStartup === true &&
    settings?.autoReconnectSuppressed !== true &&
    savedCastReceiver(settings) !== null
  );
}
