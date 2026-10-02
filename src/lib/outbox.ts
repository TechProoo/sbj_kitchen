import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { isOnline, subscribeConnectivity } from './connectivity';
import { uuid } from './ids';
import { readJson, writeJson } from './storage';
import type {
  CounterOrderInput,
  OrderItemStatus,
  OrderStatus,
  Ticket,
} from './types';

/*
 * Everything the kitchen did while it could not reach the server.
 *
 * Each action becomes an entry here, saved to the device before anything else
 * happens, and a worker plays them to the API in the order they were made once
 * the line is back. The board is drawn from the server's tickets with these
 * entries laid over the top, so what the cook sees offline is exactly what the
 * server will hold once it catches up, and a refresh in between cannot undo it.
 */

const STORAGE_KEY = 'sbj.kitchen.outbox.v1';
const SEQUENCE_KEY = 'sbj.kitchen.offline-seq';
const DEVICE_KEY = 'sbj.kitchen.device';
const RETRY_EVERY_MS = 15_000;

/// A status change made on a ticket that has not reached the server yet. It is
/// replayed against the real order once the order exists.
export interface LocalStep {
  status: OrderStatus;
  at: string;
}

export type OutboxOp =
  | {
      id: string;
      kind: 'create';
      at: string;
      payload: CounterOrderInput;
      /// What the board shows until the server has the real thing.
      ticket: Ticket;
      trail: LocalStep[];
      /// Set when the server refused the order; it stays until someone decides.
      failed?: string;
    }
  | { id: string; kind: 'status'; at: string; orderId: string; status: OrderStatus }
  | {
      id: string;
      kind: 'item';
      at: string;
      orderId: string;
      itemId: string;
      status: OrderItemStatus;
    }
  | { id: string; kind: 'cancel'; at: string; orderId: string; reason: string };

export interface OutboxState {
  ops: OutboxOp[];
  syncing: boolean;
  /// The last run that got something through, for the "all caught up" notice.
  lastSync: { orders: number; at: number } | null;
}

let state: OutboxState = {
  ops: readJson<OutboxOp[]>(STORAGE_KEY, []),
  syncing: false,
  lastSync: null,
};

const listeners = new Set<() => void>();
const ticketListeners = new Set<(ticket: Ticket) => void>();
const drainedListeners = new Set<() => void>();

/// Tickets this screen made itself. The server announces every new order over
/// the socket, and a screen should not chime at its own cashier's work.
const ownRefs = new Set<string>();
export const rememberOwn = (clientRef: string) => void ownRefs.add(clientRef);
export const isOwn = (clientRef?: string | null) =>
  Boolean(clientRef && ownRefs.has(clientRef));

function commit(next: OutboxState, persist = true) {
  state = next;
  if (persist) writeJson(STORAGE_KEY, next.ops);
  listeners.forEach((listener) => listener());
}

const change = (fn: (ops: OutboxOp[]) => OutboxOp[]) =>
  commit({ ...state, ops: fn(state.ops) });

export const getOutbox = () => state;

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useOutbox = (): OutboxState =>
  useSyncExternalStore(subscribeOutbox, getOutbox, getOutbox);

/// A drained operation hands back the server's version of the ticket.
export function onTicketSynced(fn: (ticket: Ticket) => void): () => void {
  ticketListeners.add(fn);
  return () => ticketListeners.delete(fn);
}

export function onOutboxDrained(fn: () => void): () => void {
  drainedListeners.add(fn);
  return () => drainedListeners.delete(fn);
}

/* ------------------------------------------------------------- numbering */

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/// One letter per device, so two tablets offline at once do not both hand out
/// "OFF-01" and leave the kitchen with two different tickets under one number.
function deviceLetter(): string {
  const saved = readJson<string | null>(DEVICE_KEY, null);
  if (saved) return saved;
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  writeJson(DEVICE_KEY, letter);
  return letter;
}

/// The number on a slip printed with no connection. It restarts every day,
/// like the server's own numbers, and is kept on the order afterwards.
export function nextOfflineRef(): string {
  const day = localDay();
  const saved = readJson<{ day: string; n: number }>(SEQUENCE_KEY, { day, n: 0 });
  const n = saved.day === day ? saved.n + 1 : 1;
  writeJson(SEQUENCE_KEY, { day, n });
  return `OFF-${deviceLetter()}${String(n).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- queuing */

export const isLocalTicket = (ticket: Ticket): boolean =>
  ticket.pendingSync === true;

export function queueOrder(payload: CounterOrderInput, ticket: Ticket): void {
  change((ops) => [
    ...ops,
    {
      id: uuid(),
      kind: 'create',
      at: new Date().toISOString(),
      payload,
      ticket,
      trail: [],
    },
  ]);
}

export function queueStatus(orderId: string, status: OrderStatus): void {
  change((ops) => [
    ...ops,
    { id: uuid(), kind: 'status', at: new Date().toISOString(), orderId, status },
  ]);
}

export function queueItem(
  orderId: string,
  itemId: string,
  status: OrderItemStatus,
): void {
  change((ops) => [
    // Ticking and un-ticking the same line is one change, not two.
    ...ops.filter(
      (op) => !(op.kind === 'item' && op.orderId === orderId && op.itemId === itemId),
    ),
    {
      id: uuid(),
      kind: 'item',
      at: new Date().toISOString(),
      orderId,
      itemId,
      status,
    },
  ]);
}

export function queueCancel(orderId: string, reason: string): void {
  change((ops) => [
    ...ops,
    { id: uuid(), kind: 'cancel', at: new Date().toISOString(), orderId, reason },
  ]);
}

/// A ticket that only exists on this device moves through the kitchen like any
/// other; the steps are remembered and replayed once it has a real order.
export function advanceLocal(ticketId: string, status: OrderStatus): void {
  const at = new Date().toISOString();
  change((ops) =>
    ops.map((op) =>
      op.kind === 'create' && op.ticket.id === ticketId
        ? {
            ...op,
            trail: [...op.trail, { status, at }],
            ticket: {
              ...op.ticket,
              status,
              ...(status === 'PREPARING' ? { startedAt: at } : {}),
              ...(status === 'READY' ? { readyAt: at } : {}),
            },
          }
        : op,
    ),
  );
}

/// Item ticks on a local ticket stay on this device: the server will number
/// the lines itself, so there is nothing to match them to afterwards.
export function toggleLocalItem(
  ticketId: string,
  itemId: string,
  status: OrderItemStatus,
): void {
  change((ops) =>
    ops.map((op) =>
      op.kind === 'create' && op.ticket.id === ticketId
        ? {
            ...op,
            ticket: {
              ...op.ticket,
              items: op.ticket.items.map((item) =>
                item.id === itemId ? { ...item, status } : item,
              ),
            },
          }
        : op,
    ),
  );
}

export function retryOp(id: string): void {
  change((ops) =>
    ops.map((op) =>
      op.id === id && op.kind === 'create' ? { ...op, failed: undefined } : op,
    ),
  );
  void drainOutbox();
}

export function discardOp(id: string): void {
  change((ops) => ops.filter((op) => op.id !== id));
}

/* ---------------------------------------------------------------- overlay */

/// The server's tickets with everything still waiting to be sent laid on top.
export function overlayTickets(server: Ticket[], ops: OutboxOp[]): Ticket[] {
  const byId = new Map(server.map((ticket) => [ticket.id, ticket]));

  for (const op of ops) {
    if (op.kind === 'create') continue;
    const ticket = byId.get(op.orderId);
    if (!ticket) continue;

    if (op.kind === 'status') {
      byId.set(ticket.id, {
        ...ticket,
        status: op.status,
        ...(op.status === 'CONFIRMED' ? { confirmedAt: op.at } : {}),
        ...(op.status === 'PREPARING' ? { startedAt: op.at } : {}),
        ...(op.status === 'READY' ? { readyAt: op.at } : {}),
      });
    } else if (op.kind === 'item') {
      byId.set(ticket.id, {
        ...ticket,
        items: ticket.items.map((item) =>
          item.id === op.itemId ? { ...item, status: op.status } : item,
        ),
      });
    } else {
      byId.set(ticket.id, { ...ticket, status: 'CANCELLED' });
    }
  }

  const local = ops.flatMap((op) => (op.kind === 'create' ? [op.ticket] : []));
  return [...byId.values(), ...local];
}

/* ------------------------------------------------------------------ drain */

/// A 4xx means the server understood and said no; retrying will not change
/// that. 401, 408 and 429 are about the moment, not the request.
const isRefusal = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 408, 429].includes(error.status);

function announce(ticket: Ticket) {
  ticketListeners.forEach((listener) => listener(ticket));
}

async function send(op: OutboxOp): Promise<Ticket> {
  switch (op.kind) {
    case 'create':
      return api.createManual(op.payload);
    case 'status':
      return api.setStatus(op.orderId, op.status);
    case 'item':
      return api.setItemStatus(op.orderId, op.itemId, op.status);
    case 'cancel':
      return api.cancel(op.orderId, op.reason);
  }
}

async function run(): Promise<void> {
  commit({ ...state, syncing: true }, false);
  let sentOrders = 0;
  let sentAnything = false;

  try {
    // The guard is belt and braces: every pass removes, fails or stops on an
    // entry, so this should never need it.
    for (let pass = 0; pass < 1000; pass += 1) {
      const op = state.ops.find((o) => !(o.kind === 'create' && o.failed));
      if (!op) break;

      try {
        const ticket = await send(op);
        announce(ticket);
        sentAnything = true;

        if (op.kind === 'create') {
          sentOrders += 1;
          // Whatever happened to the ticket offline now happens to the order.
          const followUps: OutboxOp[] = op.trail.map((step) => ({
            id: uuid(),
            kind: 'status',
            at: step.at,
            orderId: ticket.id,
            status: step.status,
          }));
          change((ops) => ops.flatMap((o) => (o.id === op.id ? followUps : [o])));
        } else {
          change((ops) => ops.filter((o) => o.id !== op.id));
        }
      } catch (error) {
        if (isRefusal(error)) {
          if (op.kind === 'create') {
            // Never throw away a sale the customer already walked off with.
            change((ops) =>
              ops.map((o) =>
                o.id === op.id && o.kind === 'create'
                  ? { ...o, failed: error.message }
                  : o,
              ),
            );
          } else {
            // A change to a ticket that moved on without us (someone else
            // already advanced it). The refresh after this puts it right.
            change((ops) => ops.filter((o) => o.id !== op.id));
          }
          continue;
        }
        // No connection, a server error, or an expired login: try again later.
        break;
      }
    }
  } finally {
    commit(
      {
        ...state,
        syncing: false,
        lastSync:
          sentOrders > 0 ? { orders: sentOrders, at: Date.now() } : state.lastSync,
      },
      false,
    );
    if (sentAnything) drainedListeners.forEach((listener) => listener());
  }
}

let draining: Promise<void> | null = null;

/// Sends everything waiting. Safe to call from anywhere, any number of times:
/// overlapping calls share one run.
export function drainOutbox(): Promise<void> {
  if (draining) return draining;
  if (!state.ops.some((op) => !(op.kind === 'create' && op.failed))) {
    return Promise.resolve();
  }
  draining = run().finally(() => {
    draining = null;
  });
  return draining;
}

/// Keeps trying: the moment the line comes back, and on a slow timer for the
/// case where it came back and we missed the signal.
export function startOutboxWorker(): () => void {
  const kick = () => {
    if (isOnline()) void drainOutbox();
  };

  const unsubscribe = subscribeConnectivity(kick);
  const timer = setInterval(kick, RETRY_EVERY_MS);
  kick();

  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
