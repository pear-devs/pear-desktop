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

export const defaultAPIServerConfig: APIServerConfig = {
  enabled: false,
  hostname: '0.0.0.0',
  port: 26538,
  authStrategy: AuthStrategy.AUTH_AT_FIRST,
  secret: Date.now().toString(36),

  authorizedClients: [],
  useHttps: false,
  certPath: '',
  keyPath: '',
};
