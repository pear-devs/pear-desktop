// A SolidJS wrapper for a LitElement

import { createSignal, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export interface LitElementWrapperProps {
  elementClass: CustomElementConstructor;
  props?: Record<string, unknown>;
}

export const LitElementWrapper = (props: LitElementWrapperProps) => {
  const [tagName, setTagName] = createSignal<string | null>(null);

  onMount(() => {
    // Create instance to discover tag name
    const el = new props.elementClass();
    setTagName(el.tagName.toLowerCase());
    el.remove();
  });

  return (
    <Show when={tagName()}>
      <Dynamic component={tagName()!} {...(props.props || {})} />
    </Show>
  );
};
