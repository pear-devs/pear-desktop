import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlugin, startPlugin, stopPlugin } from '@/utils';
import type { PluginConfig } from '@/types/plugins';
import type { BackendContext, RendererContext } from '@/types/contexts';

describe('Plugin Utilities', () => {
  describe('createPlugin', () => {
    it('should create a plugin definition', () => {
      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
      });

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe('test-plugin');
      expect(plugin.config?.enabled).toBe(false);
    });
  });

  describe('startPlugin', () => {
    it('should start a plugin with function lifecycle', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        ipc: {
          send: vi.fn(),
          invoke: vi.fn(),
          on: vi.fn(),
        },
      } as unknown as RendererContext<PluginConfig>;

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
        renderer: async (ctx) => {
          const config = await ctx.getConfig();
          expect(config.enabled).toBe(true);
        },
      });

      const result = await startPlugin('test-plugin', plugin, {
        ctx: 'renderer',
        context: mockContext,
      });

      expect(result).toBe(true);
    });

    it('should start a plugin with object lifecycle', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        ipc: {
          send: vi.fn(),
          invoke: vi.fn(),
          on: vi.fn(),
        },
      } as unknown as RendererContext<PluginConfig>;

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
        renderer: {
          start: async (ctx) => {
            const config = await ctx.getConfig();
            expect(config.enabled).toBe(true);
          },
        },
      });

      const result = await startPlugin('test-plugin', plugin, {
        ctx: 'renderer',
        context: mockContext,
      });

      expect(result).toBe(true);
    });

    it('should return null if plugin has no lifecycle', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        window: {} as any,
        ipc: {
          send: vi.fn(),
          handle: vi.fn(),
          on: vi.fn(),
          removeHandler: vi.fn(),
        },
      } as unknown as BackendContext<PluginConfig>;

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
      });

      const result = await startPlugin('test-plugin', plugin, {
        ctx: 'backend',
        context: mockContext,
      });

      expect(result).toBe(null);
    });
  });

  describe('stopPlugin', () => {
    it('should stop a plugin with stop method', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        ipc: {
          send: vi.fn(),
          invoke: vi.fn(),
          on: vi.fn(),
        },
      } as unknown as RendererContext<PluginConfig>;

      const stopFn = vi.fn();

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
        renderer: {
          start: async () => {},
          stop: stopFn,
        },
      });

      const result = await stopPlugin('test-plugin', plugin, {
        ctx: 'renderer',
        context: mockContext,
      });

      expect(result).toBe(true);
      expect(stopFn).toHaveBeenCalled();
    });

    it('should return false if plugin has no stop method', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        ipc: {
          send: vi.fn(),
          invoke: vi.fn(),
          on: vi.fn(),
        },
      } as unknown as RendererContext<PluginConfig>;

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
        renderer: {
          start: async () => {},
        },
      });

      const result = await stopPlugin('test-plugin', plugin, {
        ctx: 'renderer',
        context: mockContext,
      });

      expect(result).toBe(null);
    });

    it('should return false if plugin context is a function', async () => {
      const mockContext = {
        getConfig: vi.fn().mockResolvedValue({ enabled: true }),
        setConfig: vi.fn(),
        window: {} as any,
        ipc: {
          send: vi.fn(),
          handle: vi.fn(),
          on: vi.fn(),
          removeHandler: vi.fn(),
        },
      } as unknown as BackendContext<PluginConfig>;

      const plugin = createPlugin({
        name: 'test-plugin',
        config: { enabled: false },
        backend: async () => {},
      });

      const result = await stopPlugin('test-plugin', plugin, {
        ctx: 'backend',
        context: mockContext,
      });

      expect(result).toBe(false);
    });
  });
});

