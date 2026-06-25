import { customElement, type ComponentType } from 'solid-element';

export const anonymousCustomElement = <T extends object>(
  ComponentType: ComponentType<T>,
): CustomElementConstructor =>
  customElement(`pear-${crypto.randomUUID()}`, ComponentType);
