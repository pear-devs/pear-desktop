// Development-only isolated profile; never imports an installed Pear profile.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const profile = path.resolve(
  __dirname,
  '..',
  '.independent-audio-test',
  'dev-profile',
);
fs.mkdirSync(profile, { recursive: true });
app.setName('Pear Independent Audio Development');
app.setAppPath(path.resolve(__dirname, '..'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
import('../dist/main/index.js').catch((error) => {
  console.error(error);
  app.exit(1);
});
