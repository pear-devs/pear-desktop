export const waitForElement = <T extends Element>(
  selector: string,
  options: {
    maxRetry?: number;
    retryInterval?: number;
  } = {
    maxRetry: -1,
    retryInterval: 100,
  },
): Promise<T> => {
  return new Promise<T>((resolve) => {
    let retryCount = 0;
    const maxRetry = options.maxRetry ?? -1;
    const retryInterval = options.retryInterval ?? 100;
    const interval = setInterval(() => {
      if (maxRetry > 0 && retryCount >= maxRetry) {
        clearInterval(interval);
        return;
      }
      const elem = document.querySelector<T>(selector);
      if (!elem) {
        retryCount++;
        return;
      }

      clearInterval(interval);
      resolve(elem);
    }, retryInterval /* ms */);
  });
};
