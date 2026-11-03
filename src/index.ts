import { app } from 'electron';

// Request the lock to check if another instance of the app is already running
if (!app.requestSingleInstanceLock()) {
  app.exit();
} else {
  // If we can lock, load the rest of the app
  await import('@/main');
}
