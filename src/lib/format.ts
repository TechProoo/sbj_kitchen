import type { IconType } from 'react-icons';
import { LuBike, LuShoppingBag, LuUtensils } from 'react-icons/lu';

const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

export const formatMoney = (value: string | number): string =>
  naira.format(typeof value === 'number' ? value : Number(value));

export const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
  });

/// Whole minutes since `iso`. The board leans on elapsed time far more than
/// wall-clock time — a cook cares that a ticket is 14 minutes old.
export const minutesSince = (iso: string): number =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

export const formatElapsed = (iso: string): string => {
  const minutes = minutesSince(iso);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const TYPE_LABEL: Record<string, string> = {
  DELIVERY: 'Delivery',
  PICKUP: 'Pickup',
  DINE_IN: 'Dine in',
};

export const TYPE_ICON: Record<string, IconType> = {
  DELIVERY: LuBike,
  PICKUP: LuShoppingBag,
  DINE_IN: LuUtensils,
};
