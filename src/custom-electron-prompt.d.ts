declare module 'custom-electron-prompt' {
  import { type BrowserWindow } from 'electron';

  export type SelectOptions = Record<string, string>;

  export interface CounterOptions {
    minimum?: number;
    maximum?: number;
    multiFire?: boolean;
  }

  export interface KeybindOptions {
    value: string;
    label: string;
    default?: string;
  }

  export interface InputOptions {
    label: string;
    value: unknown;
    inputAttrs?: Partial<HTMLInputElement>;
    selectOptions?: SelectOptions;
  }

  interface BasePromptOptions<T extends string> {
    type?: T;
    width?: number;
    height?: number;
    resizable?: boolean;
    title?: string;
    label?: string;
    buttonLabels?: {
      ok?: string;
      cancel?: string;
    };
    alwaysOnTop?: boolean;
    value?: unknown;
    icon?: string;
    useHtmlLabel?: boolean;
    customStylesheet?: string;
    menuBarVisible?: boolean;
    skipTaskbar?: boolean;
    frame?: boolean;
    customScript?: string;
    enableRemoteModule?: boolean;
    inputAttrs?: Partial<HTMLInputElement>;
  }

  export type InputPromptOptions = BasePromptOptions<'input'>;
  export interface SelectPromptOptions extends BasePromptOptions<'select'> {
    selectOptions: SelectOptions;
  }
  export interface CounterPromptOptions extends BasePromptOptions<'counter'> {
    counterOptions: CounterOptions;
  }
  export interface MultiInputPromptOptions
    extends BasePromptOptions<'multiInput'> {
    multiInputOptions: InputOptions[];
  }
  export interface KeybindPromptOptions extends BasePromptOptions<'keybind'> {
    keybindOptions: KeybindOptions[];
  }

  export type PromptOptions<T extends string> = T extends 'input'
    ? InputPromptOptions
    : T extends 'select'
      ? SelectPromptOptions
      : T extends 'counter'
        ? CounterPromptOptions
        : T extends 'keybind'
          ? KeybindPromptOptions
          : T extends 'multiInput'
            ? MultiInputPromptOptions
            : never;

  type PromptResult<T extends string> = T extends 'input'
    ? string
    : T extends 'select'
      ? string
      : T extends 'counter'
        ? number
        : T extends 'keybind'
          ? {
              value: string;
              accelerator: string;
            }[]
          : T extends 'multiInput'
            ? string[]
            : never;

  const prompt: <T extends Type>(
    options?: PromptOptions<T> & { type: T },
    parent?: BrowserWindow,
  ) => Promise<PromptResult<T> | null>;

  export default prompt;
}
