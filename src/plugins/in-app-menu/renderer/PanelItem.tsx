import { createSignal, Match, Show, Switch } from 'solid-js';
import { type JSX } from 'solid-js/jsx-runtime';
import { css } from 'solid-styled-components';
import { Portal } from 'solid-js/web';

import { Transition } from 'solid-transition-group';
import { useFloating } from 'solid-floating-ui';
import { autoUpdate, offset, size } from '@floating-ui/dom';

import { Panel } from './Panel';
import { cacheNoArgs } from '@/providers/decorators';

const itemStyle = cacheNoArgs(
  () => css`
    position: relative;

    -webkit-app-region: none;
    min-height: 32px;
    height: 32px;

    display: grid;
    grid-template-columns: 32px 1fr auto minmax(32px, auto);
    justify-content: flex-start;
    align-items: center;

    border-radius: 4px;
    cursor: pointer;
    box-sizing: border-box;
    user-select: none;
    -webkit-user-drag: none;

    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    &:active {
      background-color: rgba(255, 255, 255, 0.2);
    }

    &[data-selected='true'] {
      background-color: rgba(255, 255, 255, 0.2);
    }

    & * {
      box-sizing: border-box;
    }
  `,
);

const itemIconStyle = cacheNoArgs(
  () => css`
    height: 32px;
    padding: 4px;
    color: white;
  `,
);

const itemLabelStyle = cacheNoArgs(
  () => css`
    font-size: 12px;
    color: white;
  `,
);

const itemChipStyle = cacheNoArgs(
  () => css`
    display: flex;
    justify-content: center;
    align-items: center;

    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    margin-left: 8px;

    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.2);
    color: #f1f1f1;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
  `,
);

const toolTipStyle = cacheNoArgs(
  () => css`
    min-width: 32px;
    width: 100%;
    height: 100%;

    padding: 4px;

    max-width: calc(var(--max-width, 100%) - 8px);
    max-height: calc(var(--max-height, 100%) - 8px);

    border-radius: 4px;
    background-color: rgba(25, 25, 25, 0.8);
    color: #f1f1f1;
    font-size: 10px;
  `,
);

const popupStyle = cacheNoArgs(
  () => css`
    position: fixed;
    top: var(--offset-y, 0);
    left: var(--offset-x, 0);

    max-width: var(--max-width, 100%);
    max-height: var(--max-height, 100%);

    z-index: 100000000;
    pointer-events: none;
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

const getParents = (element: Element | null): (HTMLElement | null)[] => {
  const parents: (HTMLElement | null)[] = [];
  let now = element;

  while (now) {
    parents.push(now as HTMLElement | null);
    now = now.parentElement;
  }

  return parents;
};

type BasePanelItemProps = {
  name: string;
  label?: string;
  chip?: string;
  toolTip?: string;
  commandId?: number;
};
type NormalPanelItemProps = BasePanelItemProps & {
  type: 'normal';
  onClick?: () => void;
};
type SubmenuItemProps = BasePanelItemProps & {
  type: 'submenu';
  level: number[];
  children: JSX.Element;
};
type RadioPanelItemProps = BasePanelItemProps & {
  type: 'radio';
  checked: boolean;
  onChange?: (checked: boolean) => void;
};
type CheckboxPanelItemProps = BasePanelItemProps & {
  type: 'checkbox';
  checked: boolean;
  onChange?: (checked: boolean) => void;
};
export type PanelItemProps =
  | NormalPanelItemProps
  | SubmenuItemProps
  | RadioPanelItemProps
  | CheckboxPanelItemProps;
export const PanelItem = (props: PanelItemProps) => {
  const [open, setOpen] = createSignal(false);
  const [toolTipOpen, setToolTipOpen] = createSignal(false);
  const [toolTip, setToolTip] = createSignal<HTMLElement | null>(null);
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const [child, setChild] = createSignal<HTMLElement | null>(null);

  const position = useFloating(anchor, toolTip, {
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      offset({ mainAxis: 8 }),
      size({
        apply({ rects, elements }) {
          elements.floating.style.setProperty(
            '--max-width',
            `${rects.reference.width}px`,
          );
        },
      }),
    ],
  });

  const handleHover = (event: MouseEvent) => {
    setToolTipOpen(true);
    event.target?.addEventListener(
      'mouseleave',
      () => {
        setToolTipOpen(false);
      },
      { once: true },
    );

    if (props.type === 'submenu') {
      const timer = setTimeout(() => {
        setOpen(true);

        let mouseX = event.clientX;
        let mouseY = event.clientY;
        const onMouseMove = (event: MouseEvent) => {
          mouseX = event.clientX;
          mouseY = event.clientY;
        };
        document.addEventListener('mousemove', onMouseMove);

        event.target?.addEventListener(
          'mouseleave',
          () => {
            setTimeout(() => {
              document.removeEventListener('mousemove', onMouseMove);
              const parents = getParents(
                document.elementFromPoint(mouseX, mouseY),
              );

              if (!parents.includes(child())) {
                setOpen(false);
              } else {
                const onOtherHover = (event: MouseEvent) => {
                  const parents = getParents(event.target as HTMLElement);
                  const closestLevel =
                    parents.find((it) => it?.dataset?.level)?.dataset.level ??
                    '';
                  const path = event.composedPath();

                  const isOtherItem = path.some(
                    (it) =>
                      it instanceof HTMLElement &&
                      it.classList.contains(itemStyle()),
                  );
                  const isChild = closestLevel.startsWith(
                    props.level.join('/'),
                  );

                  if (isOtherItem && !isChild) {
                    setOpen(false);
                    document.removeEventListener('mousemove', onOtherHover);
                  }
                };
                document.addEventListener('mousemove', onOtherHover);
              }
            }, 225);
          },
          { once: true },
        );
      }, 225);

      event.target?.addEventListener(
        'mouseleave',
        () => {
          clearTimeout(timer);
        },
        { once: true },
      );
    }
  };

  const handleClick = async () => {
    await window.ipcRenderer.invoke('peard:menu-event', props.commandId);
    if (props.type === 'radio') {
      props.onChange?.(!props.checked);
    } else if (props.type === 'checkbox') {
      props.onChange?.(!props.checked);
    } else if (props.type === 'normal') {
      props.onClick?.();
    }
  };

  return (
    <li
      class={itemStyle()}
      data-selected={open()}
      onClick={handleClick}
      onMouseEnter={handleHover}
      ref={setAnchor}
    >
      <Switch fallback={<div class={itemIconStyle()} />}>
        <Match when={props.type === 'checkbox' && props.checked}>
          <svg
            class={itemIconStyle()}
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M0 0h24v24H0z" fill="none" stroke="none" />
            <path d="M5 12l5 5l10 -10" />
          </svg>
        </Match>
        <Match when={props.type === 'radio' && props.checked}>
          <svg
            class={itemIconStyle()}
            style={{ padding: '6px' }}
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10,5 C7.2,5 5,7.2 5,10 C5,12.8 7.2,15 10,15 C12.8,15 15,12.8 15,10 C15,7.2 12.8,5 10,5 L10,5 Z M10,0 C4.5,0 0,4.5 0,10 C0,15.5 4.5,20 10,20 C15.5,20 20,15.5 20,10 C20,4.5 15.5,0 10,0 L10,0 Z M10,18 C5.6,18 2,14.4 2,10 C2,5.6 5.6,2 10,2 C14.4,2 18,5.6 18,10 C18,14.4 14.4,18 10,18 L10,18 Z"
              fill="currentColor"
            />
          </svg>
        </Match>
        <Match when={props.type === 'radio' && !props.checked}>
          <svg
            class={itemIconStyle()}
            style={{ padding: '6px' }}
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10,0 C4.5,0 0,4.5 0,10 C0,15.5 4.5,20 10,20 C15.5,20 20,15.5 20,10 C20,4.5 15.5,0 10,0 L10,0 Z M10,18 C5.6,18 2,14.4 2,10 C2,5.6 5.6,2 10,2 C14.4,2 18,5.6 18,10 C18,14.4 14.4,18 10,18 L10,18 Z"
              fill="currentColor"
            />
          </svg>
        </Match>
      </Switch>
      <span class={itemLabelStyle()}>{props.name}</span>
      <Show fallback={<div />} when={props.chip}>
        <span class={itemChipStyle()}>{props.chip}</span>
      </Show>
      <Show when={props.type === 'submenu'}>
        <svg
          class={itemIconStyle()}
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 0h24v24H0z" fill="none" stroke="none" />
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <Panel
          anchor={anchor()}
          data-level={props.type === 'submenu' && props.level.join('/')}
          offset={{ mainAxis: 8 }}
          open={open()}
          placement={'right-start'}
          ref={setChild}
        >
          {props.type === 'submenu' && props.children}
        </Panel>
      </Show>
      <Show when={props.toolTip}>
        <Portal>
          <div
            class={popupStyle()}
            ref={setToolTip}
            style={{
              '--offset-x': `${position.x}px`,
              '--offset-y': `${position.y}px`,
            }}
          >
            <Transition
              appear
              enterActiveClass={animationStyle().enterActive}
              enterClass={animationStyle().enter}
              exitActiveClass={animationStyle().exitActive}
              exitToClass={animationStyle().exitTo}
            >
              <Show when={toolTipOpen()}>
                <div class={toolTipStyle()}>{props.toolTip}</div>
              </Show>
            </Transition>
          </div>
        </Portal>
      </Show>
    </li>
  );
};
