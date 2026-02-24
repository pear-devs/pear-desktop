import { t } from '@/i18n';

import { createPlugin } from '@/utils';
const shortCuts = {
    'Meta': 'Add to queue',
    'Alt': 'Add to queue',
    'Shift': 'Play next',
    'Control': 'Save to library',
     z:'Save to playlist'
};

export default createPlugin<
    unknown,
    unknown,
    {
        start: () => void;
        onChangePage: () => void;
        keydownEvent: (e: KeyboardEvent) => void;
        keyupEvent: (e: KeyboardEvent) => void;
        popupClicker: () => void;
        cleanup: () => void;
        popup: () => HTMLElement | null;
        waiting: boolean;
        key: string | null;
        observer: MutationObserver | null;
    }
>({
    name: () => t('plugins.playbutton-shortcuts.name'),
    description: () => t('plugins.playbutton-shortcuts.description'),
    restartNeeded: true,
    config: {
        enabled: true,
    },
    addedVersion: '3.2.X',
    renderer: {
        waiting: false,
        key: null,
        observer: null,
        start() {
            window.navigation.addEventListener
            ('navigate', () => this.onChangePage());
        },
        cleanup() {
            document.removeEventListener('keydown', this.keydownEvent);
            document.removeEventListener('keyup', this.keyupEvent);
        },
        popup() {
            return document.querySelector(
                'ytmusic-menu-popup-renderer #items',
            ) as HTMLElement;
        },
        onChangePage() {
            if (this.waiting) {
                return;
            } else {
                this.waiting = true;
            }
            this.cleanup();

            document.addEventListener('keydown', this.keydownEvent);
            document.addEventListener('keyup', this.keyupEvent);
            this.waiting = false;
            this.observer = new MutationObserver(() => {
                if (this.popup() && this.key) this.popupClicker();
            });
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        },
        async popupClicker() {
            if (!this.popup()) return;
            if (this.waiting) return;

            this.waiting = true;
            this.popup()!.style.display = 'none';
            
            const operationStr = shortCuts
            [this.key as keyof typeof shortCuts];

            const length = this.popup()!.children.length;
            console.log(length);
            for (let i = 0; i < length; i++) {
                const item = this.popup()!.children[i];
                const strTag = item.querySelector
                ('yt-formatted-string') as HTMLElement;

                if (strTag.innerHTML == operationStr) {
                    if (item.querySelector('a')) {
                        item.querySelector('a')!.click();
                        break
                    }
                    (item as HTMLElement).click();
                    break;
                }
            }
            setTimeout(() => {
                this.waiting = false
                this.popup()!.style.display = 'block';
            }, 1000);
        },
        keydownEvent(e: KeyboardEvent) {
            if (Object.keys(shortCuts).includes(e.key))
                this.key = e.key;
        },
        keyupEvent(e: KeyboardEvent) {
            this.key = null;
        },
    },
});
