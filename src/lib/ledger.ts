import type { AdminOverview } from './types';

export type Order = AdminOverview['recent'][number];

export type LedgerFilter =
  | 'all'
  | 'unpaid'
  | 'offline'
  | 'cancelled'
  | 'DELIVERY'
  | 'PICKUP'
  | 'DINE_IN';

export const isUnpaid = (order: Order) =>
  order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID';

export function matchesFilter(order: Order, filter: LedgerFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unpaid':
      return isUnpaid(order);
    case 'offline':
      return order.syncedAt !== null;
    case 'cancelled':
      return order.status === 'CANCELLED';
    default:
      return order.type === filter;
  }
}
