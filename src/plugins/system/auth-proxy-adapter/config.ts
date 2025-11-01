export interface AuthProxyConfig {
  enabled: boolean;
  hostname: string;
  port: number;
}

export const defaultAuthProxyConfig: AuthProxyConfig = {
  enabled: false,
  hostname: '127.0.0.1',
  port: 4545,
};
