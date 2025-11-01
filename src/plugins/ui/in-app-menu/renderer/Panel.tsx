import { createSignal, type JSX, Show, splitProps, mergeProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { css } from 'solid-styled-components';
import { Transition } from 'solid-transition-group';
import {
  autoUpdate,
  flip,
  offset,
  type OffsetOptions,
  size,
} from '@floating-ui/dom';
import { useFloating } from 'solid-floating-ui';

import { cacheNoArgs } from '@/providers/decorators';

const panelStyle = cacheNoArgs(
  () => css`
    position: fixed;
    top: var(--offset-y, 0);
    left: var(--offset-x, 0);

    max-width: var(--max-width, 100%);
    max-height: var(--max-height, 100%);

    z-index: 10000;
    width: fit-content;
    height: fit-content;

    padding: 4px;
    box-sizing: border-box;
    border-radius: 8px;
    overflow: auto;

    background-color: color-mix(
      in srgb,
      var(--titlebar-background-color, #030303) 50%,
      rgba(0, 0, 0, 0.1)
    );
    backdrop-filter: blur(8px);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.05),
      0 2px 8px rgba(0, 0, 0, 0.2);

    transform-origin: var(--origin-x, 50%) var(--origin-y, 50%);
  `,
);

const animationStyle = cacheNoArgs(() => ({
  enter: css`
    opacity: 0;
    transform: scale(0.9);
  `,
  enterActive: css`
    transition:
      opacity 0.225s cubic-bezier(0.33, 1, 0.68, 1),
      transform 0.225s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  exitTo: css`
    opacity: 0;
    transform: scale(0.9);
  `,
  exitActive: css`
    transition:
      opacity 0.225s cubic-bezier(0.32, 0, 0.67, 0),
      transform 0.225s cubic-bezier(0.32, 0, 0.67, 0);
  `,
}));

export type Placement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'right-start'
  | 'right-end'
  | 'left-start'
  | 'left-end';
export type PanelProps = JSX.HTMLAttributes<HTMLUListElement> & {
  open?: boolean;
  anchor?: HTMLElement | null;
  children: JSX.Element;

  placement?: Placement;
  offset?: OffsetOptions;
};
export const Panel = (props: PanelProps) => {
  const [elements, local, leftProps] = splitProps(
    mergeProps({ placement: 'bottom' }, props),
    ['anchor', 'children'],
    ['open', 'placement', 'offset'],
  );

  const [panel, setPanel] = createSignal<HTMLElement | null>(null);

  const position = useFloating(() => elements.anchor, panel, {
    whileElementsMounted: autoUpdate,
    placement: local.placement as Placement,
    strategy: 'fixed',
    middleware: [
      offset(local.offset),
      size({
        padding: 8,
        apply({ elements, availableWidth, availableHeight }) {
          elements.floating.style.setProperty(
            '--max-width',
            `${Math.max(200, availableWidth)}px`,
          );
          elements.floating.style.setProperty(
            '--max-height',
            `${Math.max(200, availableHeight)}px`,
          );
        },
      }),
      flip({ fallbackStrategy: 'initialPlacement' }),
    ],
  });

  const originX = () => {
    if (position.placement.includes('left')) return '100%';
    if (position.placement.includes('right')) return '0';
    if (
      position.placement.includes('top') ||
      position.placement.includes('bottom')
    ) {
      if (position.placement.includes('start')) return '0';
      if (position.placement.includes('end')) return '100%';
    }

    return '50%';
  };
  const originY = () => {
    if (position.placement.includes('top')) return '100%';
    if (position.placement.includes('bottom')) return '0';
    if (
      position.placement.includes('left') ||
      position.placement.includes('right')
    ) {
      if (position.placement.includes('start')) return '0';
      if (position.placement.includes('end')) return '100%';
    }
    return '50%';
  };

  return (
    <Portal>
      <Transition
        appear
        enterActiveClass={animationStyle().enterActive}
        enterClass={animationStyle().enter}
        exitActiveClass={animationStyle().exitActive}
        exitToClass={animationStyle().exitTo}
      >
        <Show when={local.open}>
          <ul
            {...leftProps}
            class={panelStyle()}
            data-ytmd-sub-panel={true}
            ref={setPanel}
            style={{
              '--offset-x': `${position.x}px`,
              '--offset-y': `${position.y}px`,
              '--origin-x': originX(),
              '--origin-y': originY(),
            }}
          >
            {elements.children}
          </ul>
        </Show>
      </Transition>
    </Portal>
  );
};
