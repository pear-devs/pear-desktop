import type { AddToToastAction } from '@/types/queue';

export const createAddToToastAction = (message: string): AddToToastAction => ({
  addToToastAction: {
    item: {
      notificationTextRenderer: {
        successResponseText: { simpleText: message },
      },
    },
  },
});
