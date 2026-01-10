import type { InitData } from '@tma.js/init-data-node';

declare global {
  namespace Express {
    interface Request {
      initData?: InitData;
    }
  }
}
