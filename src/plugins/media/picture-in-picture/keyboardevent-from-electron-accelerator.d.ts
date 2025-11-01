declare module 'keyboardevent-from-electron-accelerator' {
  interface KeyboardEvent {
    key?: string;
    code?: string;
    metaKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }

  export const toKeyEvent: (accelerator: string) => KeyboardEvent;
}
