import { render } from 'solid-js/web';

import { createSignal, Show } from 'solid-js';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import {
  DislikeButton,
  LikeButton,
  UnDislikeButton,
  UnLikeButton,
} from './templates';

export default createPlugin<
  unknown,
  unknown,
  {
    observer?: MutationObserver;
    loadObserver?: MutationObserver;
    changeObserver?: MutationObserver;
    waiting: boolean;
    onPageChange(): void;
    loadFullList: (event: MouseEvent) => void;
    applyToList(id: string, loader: HTMLElement): void;
    start(): void;
    stop(): void;
  }
>({
  name: () => t('plugins.album-actions.name'),
  description: () => t('plugins.album-actions.description'),
  restartNeeded: false,
  addedVersion: '3.2.X',
  config: {
    enabled: false,
  },
  renderer: {
    waiting: false,
    start() {
      // Waits for pagechange
      this.onPageChange();
      this.observer = new MutationObserver(() => {
        this.onPageChange();
      });
      this.observer.observe(document.querySelector('#browse-page')!, {
        attributes: false,
        childList: true,
        subtree: true,
      });
    },
    async onPageChange() {
      if (this.waiting) {
        return;
      } else {
        this.waiting = true;
      }
      const continuations = await waitForElement<HTMLElement>('#continuations');
      this.waiting = false;

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
      const [unLikeMaskSize, setUnLikeMaskSize] =
        createSignal(DEFAULT_MASK_SIZE);

      const buttonContainer = document.createElement('div');
      buttonContainer.style.display = 'flex';
      buttonContainer.style.flexDirection = 'row';

      render(
        () => (
          <>
            <Show when={showUnDislike()}>
              <UnDislikeButton
                maskSize={unDislikeMaskSize()}
                onClick={this.loadFullList}
              />
            </Show>
            <Show when={showDislike()}>
              <DislikeButton
                maskSize={dislikeMaskSize()}
                onClick={this.loadFullList}
              />
            </Show>
            <Show when={showLike()}>
              <LikeButton
                maskSize={likeMaskSize()}
                onClick={this.loadFullList}
              />
            </Show>
            <Show when={showUnLike()}>
              <UnLikeButton
                maskSize={unLikeMaskSize()}
                onClick={this.loadFullList}
              />
            </Show>
          </>
        ),
        buttonContainer,
      );

      //Finds the playlist
      const playlist =
        document.querySelector('ytmusic-playlist-shelf-renderer') ??
        document.querySelector(':nth-last-child(1 of ytmusic-shelf-renderer)');

      if (!playlist) {
        return;
      }

      // Adds an observer for every button, so it gets updated when one is clicked
      this.changeObserver?.disconnect();

      this.changeObserver = new MutationObserver(() => {
        this.stop();
        this.start();
      });
      const allButtons = playlist.querySelectorAll(
        'yt-button-shape.ytmusic-like-button-renderer',
      );
      for (const btn of allButtons) {
        this.changeObserver.observe(btn, {
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
          dislike: playlist?.querySelectorAll(
            '#button-shape-dislike > button[aria-pressed=true]',
          ).length,
          undislike: playlist?.querySelectorAll(
            '#button-shape-dislike > button[aria-pressed=false]',
          ).length,
          unlike: playlist?.querySelectorAll(
            '#button-shape-like > button[aria-pressed=false]',
          ).length,
          like: playlist?.querySelectorAll(
            '#button-shape-like > button[aria-pressed=true]',
          ).length,
        };
        for (const [name, size] of Object.entries(counts)) {
          switch (name) {
            case 'dislike':
              if (size > 0) {
                setShowDislike(true);
                setDislikeMaskSize(`100% ${100 - (size / listsLength) * 100}%`);
              } else {
                setShowDislike(false);
              }
              break;
            case 'undislike':
              if (size > 0) {
                setShowUnDislike(true);
                setUnDislikeMaskSize(
                  `100% ${100 - (size / listsLength) * 100}%`,
                );
              } else {
                setShowUnDislike(false);
              }
              break;
            case 'like':
              if (size > 0) {
                setShowLike(true);
                setLikeMaskSize(`100% ${100 - (size / listsLength) * 100}%`);
              } else {
                setShowLike(false);
              }
              break;
            case 'unlike':
              if (size > 0) {
                setShowUnLike(true);
                setUnLikeMaskSize(`100% ${100 - (size / listsLength) * 100}%`);
              } else {
                setShowUnLike(false);
              }
              break;
          }
        }
      }
      const menuParent =
        document.querySelector('#action-buttons')?.parentElement;
      if (menuParent && !document.querySelector('.like-menu')) {
        const menu = document.createElement('div');
        menu.id = 'ytmd-album-action-buttons';
        menu.className =
          'action-buttons style-scope ytmusic-responsive-header-renderer';

        menuParent.insertBefore(
          menu,
          menuParent.children[menuParent.children.length - 1],
        );
        menu.appendChild(buttonContainer);
      }
    },
    loadFullList(event: MouseEvent) {
      if (event.target instanceof Element) {
        event.stopPropagation();
        const button = event.target.closest('button') as HTMLElement;
        if (!button?.id) return;
        const id = button.id;
        const loader = document.getElementById('continuations')!;
        this.loadObserver = new MutationObserver(() => {
          this.applyToList(id, loader);
        });
        this.applyToList(id, loader);
        this.loadObserver.observe(loader, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        loader?.style.setProperty('top', '0');
        loader?.style.setProperty('left', '50%');
        loader?.style.setProperty('position', 'absolute');
      }
    },
    applyToList(id: string, loader: HTMLElement) {
      if (loader.children.length != 0) return;
      this.loadObserver?.disconnect();
      let playlistButtons: NodeListOf<HTMLElement> | undefined;
      const playlist =
        document.querySelector('ytmusic-playlist-shelf-renderer') ??
        document.querySelector(':nth-last-child(1 of ytmusic-shelf-renderer)');
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
    },
    stop() {
      this.observer?.disconnect();
      this.changeObserver?.disconnect();
      for (const button of document.querySelectorAll('.like-menu')) {
        button.remove();
      }
    },
  },
});
