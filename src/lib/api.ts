import { getAccessToken } from './supabase';
import type {
  AdminOverview,
  FeedPost,
  Board,
  CounterOrderInput,
  MenuCategory,
  KitchenStats,
  OrderItemStatus,
  OrderStatus,
  SoldOutItem,
  StaffUser,
  Ticket,
} from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('Cannot reach the API server.', 0);
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

/*
 * Multipart uploads set their own Content-Type, boundary included. Letting
 * the JSON header through would make the server parse the body as JSON and
 * find nothing.
 */
async function upload<T>(path: string, body: FormData): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

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
  overview: (day?: string) =>
    request<AdminOverview>(`/admin/overview${day ? `?day=${day}` : ''}`),

  order: (id: string) => request<Ticket>(`/orders/${id}`),

  /// The whole menu, for typing an order in at the counter.
  menu: () => request<MenuCategory[]>('/menu'),

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

  setItemAvailability: (menuItemId: string, isAvailable: boolean) =>
    request<unknown>(`/menu/items/${menuItemId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable }),
    }),
};

export { API_URL };
