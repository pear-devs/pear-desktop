import { BrowserWindow, clipboard } from 'electron';
import qrcode from 'qrcode-generator';

import { t } from '@/i18n';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const buildPage = (link: string) => {
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; text-align: center; background: #fff; color: #111; }
  .qr { width: 260px; height: 260px; margin: 0 auto 12px; }
  .qr svg { width: 100%; height: 100%; display: block; }
  code { display: block; word-break: break-all; font-size: 12px; margin: 8px 0; color: #444; }
  p { margin: 6px 0; font-size: 12px; color: #666; }
</style></head>
<body>
  <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })}</div>
  <strong>${escapeHtml(t('plugins.karaoke.menu.phone-link.scan'))}</strong>
  <code>${escapeHtml(link)}</code>
  <p>${escapeHtml(t('plugins.karaoke.menu.phone-link.detail'))}</p>
</body></html>`;
};

export const showPhoneQr = (parent: BrowserWindow, link: string) => {
  clipboard.writeText(link);

  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 340,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: t('plugins.karaoke.menu.phone-link.label'),
    webPreferences: { sandbox: true, javascript: false },
  });
  win.setMenu(null);
  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildPage(link))}`,
  );
};
