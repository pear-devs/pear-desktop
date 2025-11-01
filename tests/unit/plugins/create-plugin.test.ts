import { describe, it, expect } from 'vitest';
import { createPlugin } from '@/utils';

describe('createPlugin', () => {
  it('should create a plugin with minimal config', () => {
    const plugin = createPlugin({
      name: 'test-plugin',
      config: { enabled: false },
    });

    expect(plugin.name).toBe('test-plugin');
    expect(plugin.config?.enabled).toBe(false);
  });

  it('should create a plugin with function name', () => {
    const plugin = createPlugin({
      name: () => 'Dynamic Plugin Name',
      config: { enabled: true },
    });

    expect(typeof plugin.name).toBe('function');
    if (typeof plugin.name === 'function') {
      expect(plugin.name()).toBe('Dynamic Plugin Name');
    }
  });

  it('should create a plugin with backend lifecycle', () => {
    const plugin = createPlugin({
      name: 'test-plugin',
      config: { enabled: false },
      backend: {
        start: async () => {},
      },
    });

    expect(plugin.backend).toBeDefined();
    expect(typeof plugin.backend?.start).toBe('function');
  });

  it('should create a plugin with renderer lifecycle', () => {
    const plugin = createPlugin({
      name: 'test-plugin',
      config: { enabled: false },
      renderer: {
        start: async () => {},
      },
    });

    expect(plugin.renderer).toBeDefined();
    expect(typeof plugin.renderer?.start).toBe('function');
  });

  it('should create a plugin with menu configuration', async () => {
    const plugin = createPlugin({
      name: 'test-plugin',
      config: { enabled: false },
      menu: async () => [
        {
          label: 'Test Menu',
          click: () => {},
        },
      ],
    });

    expect(plugin.menu).toBeDefined();
    expect(typeof plugin.menu).toBe('function');
    
    if (typeof plugin.menu === 'function') {
      const menu = await plugin.menu({
        window: {} as any,
        getConfig: async () => ({ enabled: false }),
        setConfig: async () => {},
      });
      expect(Array.isArray(menu)).toBe(true);
    }
  });
});

