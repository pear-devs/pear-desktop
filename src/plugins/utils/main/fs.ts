import fs from 'node:fs';

export const fileExists = (
  path: fs.PathLike,
  callbackIfExists: { (): void; (): void; (): void },
  callbackIfError?: (() => void) ,
) => {
  fs.access(path, fs.constants.F_OK, (error) => {
    if (error) {
      callbackIfError?.();

      return;
    }

    callbackIfExists();
  });
};
