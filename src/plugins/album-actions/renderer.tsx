import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { createRenderer } from '@/utils';

import {
  DislikeButton,
  LikeButton,
  UnDislikeButton,
  UnLikeButton,
} from './templates';

const getPlaylist = () =>
  document.querySelector('ytmusic-playlist-shelf-renderer') ??
  document.querySelector(':nth-last-child(1 of ytmusic-shelf-renderer)');

const maskSizeOf = (size: number, total: number) => {
  const percent = (size / total) * 100;
  return `100% ${100 - percent}%`;
};

export default createRenderer((ctx) => {
  let waiting = false;
  let observer: MutationObserver | undefined;
  let changeObserver: MutationObserver | undefined;
  let loadObserver: MutationObserver | undefined;
  /** The inserted `#ytmd-album-action-buttons` element and its Solid root. */
  let mounted: { menu: HTMLElement; dispose: () => void } | undefined;
  /** `#continuations` elements whose position `loadFullList` changed. */
  const movedLoaders = new Set<HTMLElement>();

  const unmount = () => {
    mounted?.dispose();
    mounted?.menu.remove();
    mounted = undefined;
  };

  // Waits for `#continuations`; resolves with null if the plugin stops first.
  const waitForContinuations = () =>
    new Promise<HTMLElement | null>((resolve) => {
      if (ctx.signal.aborted) return resolve(null);
      const onAbort = () => resolve(null);
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const timer = ctx.setInterval(() => {
        const element = document.querySelector<HTMLElement>('#continuations');
        if (!element) return;
        ctx.clearInterval(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(element);
      }, 100);
    });

  const applyToList = (id: string, loader: HTMLElement) => {
    if (loader.children.length != 0) return;
    loadObserver?.disconnect();
    let playlistButtons: NodeListOf<HTMLElement> | undefined;
    const playlist = getPlaylist();
    switch (id) {
      case 'allundislike':
        playlistButtons = playlist?.querySelectorAll(
          '#button-shape-dislike > button[aria-pressed=true]',
        );
        break;
      case 'alldislike':
        playlistButtons = playlist?.querySelectorAll(
          '#button-shape-dislike > button[aria-pressed=false]',
        );
        break;
      case 'alllike':
        playlistButtons = playlist?.querySelectorAll(
          '#button-shape-like > button[aria-pressed=false]',
        );
        break;
      case 'allunlike':
        playlistButtons = playlist?.querySelectorAll(
          '#button-shape-like > button[aria-pressed=true]',
        );
        break;
      default:
    }
    playlistButtons?.forEach((elem) => elem.click());
  };

  const loadFullList = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    event.stopPropagation();
    const button = event.target.closest('button');
    if (!button?.id) return;
    const id = button.id;
    const loader = document.getElementById('continuations');
    if (!loader) return;

    loadObserver?.disconnect();
    loadObserver = ctx.observe(
      loader,
      { attributes: true, childList: true, subtree: true },
      () => applyToList(id, loader),
    );
    applyToList(id, loader);
    movedLoaders.add(loader);
    loader.style.setProperty('top', '0');
    loader.style.setProperty('left', '50%');
    loader.style.setProperty('position', 'absolute');
  };

  const onPageChange = async () => {
    if (waiting) return;
    waiting = true;
    const continuations = await waitForContinuations();
    waiting = false;
    if (!continuations || ctx.signal.aborted) return;

    const [showUnDislike, setShowUnDislike] = createSignal(true);
    const [showDislike, setShowDislike] = createSignal(true);
    const [showLike, setShowLike] = createSignal(true);
    const [showUnLike, setShowUnLike] = createSignal(true);

    const DEFAULT_MASK_SIZE = '100% 50%';
    const [unDislikeMaskSize, setUnDislikeMaskSize] =
      createSignal(DEFAULT_MASK_SIZE);
    const [dislikeMaskSize, setDislikeMaskSize] =
      createSignal(DEFAULT_MASK_SIZE);
    const [likeMaskSize, setLikeMaskSize] = createSignal(DEFAULT_MASK_SIZE);
    const [unLikeMaskSize, setUnLikeMaskSize] = createSignal(DEFAULT_MASK_SIZE);

    //Finds the playlist
    const playlist = getPlaylist();
    if (!playlist) return;

    // Adds an observer for every button, so it gets updated when one is clicked
    changeObserver?.disconnect();
    changeObserver = new MutationObserver(() => {
      stop();
      start();
    });
    const allButtons = playlist.querySelectorAll(
      'yt-button-shape.ytmusic-like-button-renderer',
    );
    for (const btn of allButtons) {
      changeObserver.observe(btn, {
        attributes: true,
        childList: false,
        subtree: false,
      });
    }

    //Determine if button is needed and colors the percentage
    const listsLength = playlist.querySelectorAll(
      '#button-shape-dislike > button',
    ).length;
    if (continuations.children.length == 0 && listsLength > 0) {
      const counts = {
        dislike: playlist.querySelectorAll(
          '#button-shape-dislike > button[aria-pressed=true]',
        ).length,
        undislike: playlist.querySelectorAll(
          '#button-shape-dislike > button[aria-pressed=false]',
        ).length,
        unlike: playlist.querySelectorAll(
          '#button-shape-like > button[aria-pressed=false]',
        ).length,
        like: playlist.querySelectorAll(
          '#button-shape-like > button[aria-pressed=true]',
        ).length,
      };
      const setters = {
        dislike: [setShowDislike, setDislikeMaskSize],
        undislike: [setShowUnDislike, setUnDislikeMaskSize],
        like: [setShowLike, setLikeMaskSize],
        unlike: [setShowUnLike, setUnLikeMaskSize],
      } as const;
      for (const [name, size] of Object.entries(counts)) {
        const [setShow, setMaskSize] = setters[name as keyof typeof counts];
        if (size > 0) {
          setShow(true);
          setMaskSize(maskSizeOf(size, listsLength));
        } else {
          setShow(false);
        }
      }
    }

    const menuParent = document.querySelector('#action-buttons')?.parentElement;
    if (!menuParent || document.querySelector('.like-menu')) return;

    // A previous menu whose buttons are all hidden is replaced.
    unmount();

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.flexDirection = 'row';

    const dispose = render(
      () => (
        <>
          <Show when={showUnDislike()}>
            <UnDislikeButton
              maskSize={unDislikeMaskSize()}
              onClick={loadFullList}
            />
          </Show>
          <Show when={showDislike()}>
            <DislikeButton
              maskSize={dislikeMaskSize()}
              onClick={loadFullList}
            />
          </Show>
          <Show when={showLike()}>
            <LikeButton maskSize={likeMaskSize()} onClick={loadFullList} />
          </Show>
          <Show when={showUnLike()}>
            <UnLikeButton maskSize={unLikeMaskSize()} onClick={loadFullList} />
          </Show>
        </>
      ),
      buttonContainer,
    );

    const menu = document.createElement('div');
    menu.id = 'ytmd-album-action-buttons';
    menu.className =
      'action-buttons style-scope ytmusic-responsive-header-renderer';

    menuParent.insertBefore(
      menu,
      menuParent.children[menuParent.children.length - 1],
    );
    menu.appendChild(buttonContainer);
    mounted = { menu, dispose };
  };

  // Restartable: a click on any like/dislike button rebuilds the menu.
  const start = () => {
    // Waits for pagechange
    onPageChange();
    const browsePage = document.querySelector('#browse-page');
    if (browsePage) {
      observer = ctx.observe(
        browsePage,
        { attributes: false, childList: true, subtree: true },
        () => onPageChange(),
      );
    }
  };

  const stop = () => {
    observer?.disconnect();
    changeObserver?.disconnect();
    unmount();
  };

  start();

  ctx.onCleanup(() => {
    stop();
    loadObserver?.disconnect();
    for (const loader of movedLoaders) {
      loader.style.removeProperty('top');
      loader.style.removeProperty('left');
      loader.style.removeProperty('position');
    }
  });
});
