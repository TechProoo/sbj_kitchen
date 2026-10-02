import { API_URL } from './config';
import { setReachable } from './connectivity';
import { readJson, writeJson } from './storage';
import { getAccessToken, supabase } from './supabase';
import type {
  AdminOverview,
  FeedPost,
  Board,
  CounterOrderInput,
  MenuCategory,
  MenuCategoryRef,
  MenuEditorItem,
  MenuItemInput,
  KitchenStats,
  OrderItemStatus,
  OrderStatus,
  SoldOutItem,
  StaffUser,
  Ticket,
} from './types';

/// A request that has not answered by now is as good as offline: waiting
/// longer just freezes a button in a kitchen that is already busy.
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/// Every kitchen call is authenticated, so the token is attached here rather
/// than at each call site. Supabase refreshes it in the background.
async function request<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const token = await getAccessToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    setReachable(false);
    throw new ApiError('Cannot reach the API server.', 0);
  } finally {
    clearTimeout(timer);
  }

  // Any answer at all, even an error, means the server is there.
  setReachable(true);

  // A token that expired while the screen was offline: refresh once, retry once.
  if (response.status === 401 && !retried) {
    const { data } = await supabase.auth.refreshSession().catch(() => ({
      data: { session: null },
    }));
    if (data.session) return request<T>(path, init, true);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join('. ')
      : (body?.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/// Read-through cache for data the counter needs when the line is down. A live
/// answer refreshes the copy; a failure to connect falls back to it.
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const fresh = await load();
    writeJson(key, fresh);
    return fresh;
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      const saved = readJson<T | null>(key, null);
      if (saved !== null) return saved;
    }
    throw error;
  }
}

/*
 * Multipart uploads set their own Content-Type, boundary included. Letting
 * the JSON header through would make the server parse the body as JSON and
 * find nothing.
 */
async function upload<T>(path: string, body: FormData): Promise<T> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      body,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    setReachable(false);
    throw new ApiError('Cannot reach the API server.', 0);
  }
  setReachable(true);

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(parsed?.message)
      ? parsed.message.join('. ')
      : (parsed?.message ?? `Upload failed (${response.status})`);
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  me: () => request<StaffUser>('/auth/me'),

  board: () => request<Board>('/kitchen/board'),

  stats: () => request<KitchenStats>('/kitchen/stats'),

  soldOut: () => request<SoldOutItem[]>('/kitchen/sold-out'),

  /// Every post, drafts included — the customer endpoint hides unpublished.
  feedAll: () => request<FeedPost[]>('/feed/all'),

  createFeedPost: (body: FormData) => upload<FeedPost>('/feed', body),

  setFeedPublished: (id: string, isPublished: boolean) =>
    request<FeedPost>(`/feed/${id}/published`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished }),
    }),

  deleteFeedPost: (id: string) =>
    request<{ id: string }>(`/feed/${id}`, { method: 'DELETE' }),

  /// The owner's panel. `day` is YYYY-MM-DD; omitted, the API reports today.
  /// Offline, the last copy of that day is shown, marked `fromCache`.
  overview: async (day?: string): Promise<AdminOverview> => {
    const key = `sbj.kitchen.overview.${day ?? 'today'}`;
    try {
      const report = await request<AdminOverview>(
        `/admin/overview${day ? `?day=${day}` : ''}`,
      );
      writeJson(key, report);
      return report;
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        const saved = readJson<AdminOverview | null>(key, null);
        if (saved) return { ...saved, fromCache: true };
      }
      throw error;
    }
  },

  order: (id: string) => request<Ticket>(`/orders/${id}`),

  /// The whole menu, for typing an order in at the counter.
  menu: () =>
    cached('sbj.kitchen.menu', () => request<MenuCategory[]>('/menu')),

  /// A walk-in or phoned-through order. Lands on the board already accepted.
  createManual: (input: CounterOrderInput) =>
    request<Ticket>('/orders/manual', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  setStatus: (id: string, status: OrderStatus, note?: string) =>
    request<Ticket>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(note ? { status, note } : { status }),
    }),

  /// Taking payment on a ticket that went out unpaid.
  setPayment: (
    id: string,
    paymentStatus: 'PAID' | 'UNPAID',
    paymentMethod?: 'CASH' | 'CARD' | 'TRANSFER',
  ) =>
    request<Ticket>(`/orders/${id}/payment`, {
      method: 'PATCH',
      body: JSON.stringify(
        paymentMethod ? { paymentStatus, paymentMethod } : { paymentStatus },
      ),
    }),

  claim: (id: string) =>
    request<Ticket>(`/orders/${id}/claim`, { method: 'PATCH' }),

  setItemStatus: (orderId: string, itemId: string, status: OrderItemStatus) =>
    request<Ticket>(`/orders/${orderId}/items/${itemId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  cancel: (id: string, reason: string) =>
    request<Ticket>(`/orders/${id}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  /// Every item, switched-off ones included, for the menu editor.
  menuItems: () =>
    request<MenuEditorItem[]>('/menu/items?includeUnavailable=true&take=100'),

  menuCategories: () => request<MenuCategoryRef[]>('/menu/categories'),

  createCategory: (name: string) =>
    request<MenuCategoryRef>('/menu/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  uploadMenuImage: (body: FormData) =>
    upload<{ url: string }>('/menu/items/image', body),

  createMenuItem: (input: MenuItemInput) =>
    request<MenuEditorItem>('/menu/items', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateMenuItem: (id: string, input: Partial<MenuItemInput>) =>
    request<MenuEditorItem>(`/menu/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteMenuItem: (id: string) =>
    request<unknown>(`/menu/items/${id}`, { method: 'DELETE' }),

  setItemAvailability: (menuItemId: string, isAvailable: boolean) =>
    request<unknown>(`/menu/items/${menuItemId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable }),
    }),
};

export { API_URL };
