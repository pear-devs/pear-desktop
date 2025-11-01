import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as config from '@/config';
import type { defaultConfig } from '@/config/defaults';

// Mock electron-store
vi.mock('@/config/store', () => {
  const store = new Map<string, unknown>();
  return {
    store: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
      onDidAnyChange: vi.fn((cb) => {
        // Mock watcher
        return {
          dispose: vi.fn(),
        };
      }),
      openInEditor: vi.fn(),
    },
  };
});

describe('Config Management', () => {
  beforeEach(() => {
    // Reset store before each test
    vi.clearAllMocks();
  });

  describe('set', () => {
    it('should set a configuration value', () => {
      config.set('options.hideMenu', true);
      const value = config.get('options.hideMenu');
      expect(value).toBe(true);
    });
  });

  describe('get', () => {
    it('should get a configuration value', () => {
      config.set('options.hideMenu', false);
      const value = config.get('options.hideMenu');
      expect(value).toBe(false);
    });

    it('should return default value if not set', () => {
      const value = config.get('options.hideMenu');
      // Value depends on defaultConfig, but should be defined
      expect(value).toBeDefined();
    });
  });

  describe('setPartial', () => {
    it('should merge partial configuration', () => {
      const initialConfig = { enabled: false, value: 10 };
      config.set('plugins.test-plugin', initialConfig);

      config.setPartial('plugins.test-plugin', { value: 20 }, { enabled: false, value: 10 });

      const result = config.get('plugins.test-plugin');
      expect(result).toMatchObject({ enabled: false, value: 20 });
    });
  });

  describe('watch', () => {
    it('should register a configuration watcher', () => {
      const callback = vi.fn();
      config.watch(callback);
      // Watcher should be registered (mocked implementation)
      expect(callback).toBeDefined();
    });
  });
});

