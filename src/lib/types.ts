export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderItemStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

export type OrderType = 'DELIVERY' | 'PICKUP' | 'DINE_IN';

export type StaffRole = 'ADMIN' | 'MANAGER' | 'KITCHEN' | 'CASHIER';

export interface StaffUser {
  id: string;
  email: string;
  role: StaffRole | null;
  fullName: string | null;
}

export interface TicketItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  /// Captured at order time, so a later menu price change cannot rewrite a
  /// ticket the customer is holding.
  unitPrice: string;
  lineTotal: string;
  notes: string | null;
  status: OrderItemStatus;
  modifiers: { nameSnapshot: string }[];
}

export interface Ticket {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  type: OrderType;
  customerName: string;
  customerPhone: string;
  tableNumber: string | null;
  notes: string | null;
  subtotal: string;
  deliveryFee: string;
  total: string;
  paymentStatus: string;
  paymentMethod: string | null;
  /// ONLINE from the storefront, WALK_IN or PHONE when staff typed it in.
  channel: string;
  placedAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  items: TicketItem[];
  address: { line1: string; city: string; landmark: string | null } | null;
  claimedBy: { id: string; fullName: string } | null;
}

export interface Board {
  columns: Record<'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY', Ticket[]>;
  total: number;
  fetchedAt: string;
}

export interface KitchenStats {
  live: { pending: number; confirmed: number; preparing: number; ready: number };
  today: {
    orders: number;
    revenue: string;
    completed: number;
    averagePrepMinutes: number | null;
  };
}

export interface SoldOutItem {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ admin */

export interface AdminOverview {
  /// The service day this report covers, as YYYY-MM-DD.
  day: string;
  isToday: boolean;
  asOf: string;

  sales: {
    orders: number;
    revenue: string;
    subtotal: string;
    deliveryFees: string;
    discounts: string;
    averageOrder: string;
    collected: string;
    outstanding: string;
    cancelledOrders: number;
    cancelledValue: string;
    completedOrders: number;
    averagePrepMinutes: number | null;
  };

  byType: { type: string; orders: number; revenue: string }[];
  byPaymentStatus: { status: string; orders: number; revenue: string }[];
  byPaymentMethod: { method: string | null; orders: number; revenue: string }[];
  byStatus: { status: OrderStatus; orders: number }[];

  live: {
    total: number;
    byStatus: { status: OrderStatus; orders: number }[];
  };

  hours: { hour: number; orders: number; revenue: string }[];
  days: { day: string; orders: number; revenue: string }[];
  topItems: { name: string; quantity: number; revenue: string }[];

  recent: {
    id: string;
    orderNumber: string;
    customerName: string;
    type: string;
    status: OrderStatus;
    paymentStatus: string;
    paymentMethod: string | null;
    total: string;
    placedAt: string;
    completedAt: string | null;
    claimedBy: string | null;
  }[];

  staff: {
    id: string;
    fullName: string | null;
    email: string;
    role: StaffRole;
    isActive: boolean;
  }[];

  menu: {
    available: number;
    soldOut: number;
    soldOutItems: { id: string; name: string; category: string }[];
  };
}

/* ------------------------------------------------------- counter ordering */

export interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
  isAvailable: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  isAvailable: boolean;
  spiceLevel: number;
  modifierGroups: ModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  slug: string;
  items: MenuItem[];
}

/// What the counter sheet posts. Everything the customer would have typed is
/// optional here: staff are standing in front of them.
export interface CounterOrderInput {
  customerName?: string;
  customerPhone?: string;
  type: OrderType;
  channel?: 'WALK_IN' | 'PHONE';
  items: {
    menuItemId: string;
    quantity: number;
    modifierIds?: string[];
    notes?: string;
  }[];
  address?: { line1: string; city: string; landmark?: string };
  tableNumber?: string;
  paymentMethod?: 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE';
  paid?: boolean;
  notes?: string;
}
