import { customElement, type ComponentType } from 'solid-element';

export const anonymousCustomElement = <T extends object>(
  ComponentType: ComponentType<T>,
): CustomElementConstructor => {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return customElement(`pear-${id}`, ComponentType);
};
