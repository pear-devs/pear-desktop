import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type PortablePathName = 'userData' | 'sessionData' | 'logs' | 'crashDumps';

export const getWindowsPortableDir = (
  platform: NodeJS.Platform,
  processType: string | undefined,
  executableDir: string | undefined,
): string | undefined =>
  platform === 'win32' && processType === 'browser'
    ? executableDir || undefined
    : undefined;

export const configureWindowsPortablePaths = (
  portableDir: string,
  setPath: (name: PortablePathName, value: string) => void,
) => {
  const userDataPath = path.join(path.resolve(portableDir), 'user-data');
  const logsPath = path.join(userDataPath, 'logs');
  const crashDumpsPath = path.join(userDataPath, 'crash-dumps');

  for (const directory of [userDataPath, logsPath, crashDumpsPath]) {
    fs.mkdirSync(directory, { recursive: true });
    if (
      !fs.statSync(directory).isDirectory() ||
      fs.lstatSync(directory).isSymbolicLink()
    ) {
      throw new Error(`Portable data path is not a directory: ${directory}`);
    }
  }

  // A unique, exclusive probe cannot overwrite or delete an existing file.
  const probePath = path.join(userDataPath, `.writable-test-${randomUUID()}`);
  fs.writeFileSync(probePath, '', { flag: 'wx' });
  try {
    fs.unlinkSync(probePath);
  } catch (error) {
    console.warn('Could not remove portable writability test file:', error);
  }

  setPath('userData', userDataPath);
  setPath('sessionData', userDataPath);
  setPath('logs', logsPath);
  setPath('crashDumps', crashDumpsPath);
};
