const MUSIC_HOST_PATTERN = /^(https?:\/\/)music\.youtube\.com(?=[:/?#]|$)/i;

export const stripMusicSubdomain = (url: string) =>
  url.replace(MUSIC_HOST_PATTERN, '$1youtube.com');

export const rewriteShareUrlInput = (root: ParentNode) => {
  const input = root.querySelector<HTMLInputElement>('#share-url');
  if (!input) return false;

  const canonicalUrl = stripMusicSubdomain(input.value);
  if (canonicalUrl === input.value) return false;

  input.value = canonicalUrl;
  return true;
};

export const createShareUrlRewriter = (
  root: Document = document,
  Observer: typeof MutationObserver = MutationObserver,
) => {
  let observer: MutationObserver | undefined;
  let pendingRewrite: ReturnType<typeof setTimeout> | undefined;

  const rewrite = () => rewriteShareUrlInput(root);
  const rewriteBeforeClick = () => rewrite();
  const rewriteAfterChange = () => {
    if (pendingRewrite) clearTimeout(pendingRewrite);
    pendingRewrite = setTimeout(() => {
      pendingRewrite = undefined;
      rewrite();
    }, 0);
  };

  return {
    start() {
      if (observer) return;

      observer = new Observer(rewrite);
      observer.observe(root.documentElement, {
        childList: true,
        subtree: true,
      });
      root.addEventListener('click', rewriteBeforeClick, true);
      root.addEventListener('change', rewriteAfterChange, true);
      rewrite();
    },
    stop() {
      observer?.disconnect();
      observer = undefined;
      root.removeEventListener('click', rewriteBeforeClick, true);
      root.removeEventListener('change', rewriteAfterChange, true);

      if (pendingRewrite) {
        clearTimeout(pendingRewrite);
        pendingRewrite = undefined;
      }
    },
  };
};
