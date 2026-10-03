export enum AuthStrategy {
  AUTH_AT_FIRST = 'AUTH_AT_FIRST',
  NONE = 'NONE',
}

export interface APIServerConfig {
  enabled: boolean;
  hostname: string;
  port: number;
  authStrategy: AuthStrategy;
  secret: string;

  authorizedClients: string[];
  useHttps: boolean;
  certPath: string;
  keyPath: string;
}

const generateSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

export const defaultAPIServerConfig: APIServerConfig = {
  enabled: false,
  hostname: '127.0.0.1',
  port: 26538,
  authStrategy: AuthStrategy.AUTH_AT_FIRST,
  secret: generateSecret(),

  authorizedClients: [],
  useHttps: false,
  certPath: '',
  keyPath: '',
};
