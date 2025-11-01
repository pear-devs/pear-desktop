declare module 'keyboardevents-areequal' {
  interface KeyboardEvent {
    key?: string;
    code?: string;
    metaKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }

  const areEqual: (event1: KeyboardEvent, event2: KeyboardEvent) => boolean;

  export default areEqual;
}
