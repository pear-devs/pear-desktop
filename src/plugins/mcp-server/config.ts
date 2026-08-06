export interface McpServerConfig {
  enabled: boolean;
  port: number;
}

export const defaultMcpServerConfig: McpServerConfig = {
  enabled: false,
  port: 26539,
};
