import { ElementFromHtml } from '@/plugins/utils/renderer';
import { t } from '@/i18n';

import statusHTML from '../templates/status.html?raw';

import type { Permission, Profile } from '../types';

export const createStatus = () => {
  const element = ElementFromHtml(statusHTML);
  const icon = document.querySelector<HTMLImageElement>(
    'ytmusic-settings-button > tp-yt-paper-icon-button > tp-yt-iron-icon#icon img',
  );

  const profile = element.querySelector<HTMLImageElement>(
    '.music-together-profile',
  )!;
  const statusLabel = element.querySelector<HTMLSpanElement>(
    '#music-together-status-label',
  )!;
  const permissionLabel = element.querySelector<HTMLMarqueeElement>(
    '#music-together-permission-label',
  )!;

  profile.src = icon?.src ?? '';

  const setStatus = (status: 'disconnected' | 'host' | 'guest') => {
    if (status === 'disconnected') {
      statusLabel.textContent = t(
        'plugins.music-together.menu.status.disconnected',
      );
      statusLabel.style.color = 'rgba(255, 255, 255, 0.5)';
    }

    if (status === 'host') {
      statusLabel.textContent = t('plugins.music-together.menu.status.host');
      statusLabel.style.color = 'rgba(255, 0, 0, 1)';
    }

    if (status === 'guest') {
      statusLabel.textContent = t('plugins.music-together.menu.status.guest');
      statusLabel.style.color = 'rgba(255, 255, 255, 1)';
    }
  };

  const setPermission = (permission: Permission) => {
    if (permission === 'host-only') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.host-only',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 0.5)';
    }

    if (permission === 'playlist') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.playlist',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 0.75)';
    }

    if (permission === 'all') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.all',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 1)';
    }
  };

  const setProfile = (src: string) => {
    profile.src = src;
  };

  const setUsers = (users: Profile[]) => {
    const container = element.querySelector<HTMLDivElement>(
      '.music-together-user-container',
    )!;
    const empty = element.querySelector<HTMLElement>('.music-together-empty')!;
    for (const child of Array.from(container.children)) {
      if (child !== empty) child.remove();
    }

    if (users.length === 0) empty.style.display = 'block';
    else empty.style.display = 'none';

    for (const user of users) {
      const img = document.createElement('img');
      img.classList.add('music-together-profile');
      img.src = user.thumbnail ?? '';
      img.title = user.name;
      img.alt = `${user.name} (${user.id})`;

      container.append(img);
    }
  };

  return {
    element,
    setStatus,
    setUsers,
    setProfile,
    setPermission,
  };
};
