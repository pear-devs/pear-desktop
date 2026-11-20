export interface InAppMenuConfig {
  enabled: boolean;
  hideDOMWindowControls: boolean;
  hideBarWhenCollapsed: boolean;
}
export const defaultInAppMenuConfig: InAppMenuConfig = {
  enabled:
    ((typeof window !== 'undefined' &&
      !window.navigator?.userAgent?.toLowerCase().includes('mac')) ||
      (typeof global !== 'undefined' &&
        global.process?.platform !== 'darwin')) &&
    ((typeof window !== 'undefined' &&
      !window.navigator?.userAgent?.toLowerCase().includes('linux')) ||
      (typeof global !== 'undefined' && global.process?.platform !== 'linux')),
  hideDOMWindowControls: false,
  hideBarWhenCollapsed: false,
};
