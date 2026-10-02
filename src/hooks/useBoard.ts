import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { playNewOrderChime } from '../lib/chime';
import { useOnline } from '../lib/connectivity';
import {
  drainOutbox,
  getOutbox,
  isOwn,
  onOutboxDrained,
  onTicketSynced,
  overlayTickets,
  startOutboxWorker,
  useOutbox,
} from '../lib/outbox';
import { connectKitchenSocket, disconnectKitchenSocket } from '../lib/socket';
import { readJson, writeJson } from '../lib/storage';
import type { KitchenStats, OrderStatus, Ticket } from '../lib/types';

const LIVE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

const BOARD_KEY = 'sbj.kitchen.board';
const STATS_KEY = 'sbj.kitchen.stats';

const byAge = (a: Ticket, b: Ticket) =>
  Date.parse(a.placedAt) - Date.parse(b.placedAt);

export interface BoardState {
  tickets: Ticket[];
  columns: Record<'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY', Ticket[]>;
  stats: KitchenStats | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  newIds: Set<string>;
  refresh: () => Promise<void>;
  applyTicket: (ticket: Ticket) => void;
  patchTicket: (id: string, update: (ticket: Ticket) => Ticket) => void;
}

/// Owns the board's live state: one REST fetch for the initial paint, then
/// socket events patch individual tickets. A full refetch happens on reconnect,
/// because anything could have changed while the screen was offline.
///
/// The last board is kept on the device, so a screen that reloads with no
/// connection still opens on the tickets it had. What the cook did while
/// offline is laid over the server's tickets from the outbox, which is why a
/// refresh can never undo it.
export function useBoard(enabled: boolean): BoardState {
  const [serverTickets, setServerTickets] = useState<Ticket[]>(() =>
    readJson<Ticket[]>(BOARD_KEY, []),
  );
  const [stats, setStats] = useState<KitchenStats | null>(() =>
    readJson<KitchenStats | null>(STATS_KEY, null),
  );
  const [socketUp, setSocketUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const online = useOnline();
  const outbox = useOutbox();

  // Refs so the socket handlers, registered once, never read stale state.
  const knownIds = useRef<Set<string>>(
    new Set(readJson<Ticket[]>(BOARD_KEY, []).map((ticket) => ticket.id)),
  );
  const refreshing = useRef<Promise<void> | null>(null);

  const applyTicket = useCallback((ticket: Ticket) => {
    setServerTickets((current) => {
      const withoutIt = current.filter((entry) => entry.id !== ticket.id);
      // A completed or cancelled ticket leaves the board entirely.
      if (!LIVE.includes(ticket.status)) return withoutIt;
      return [...withoutIt, ticket].sort(byAge);
    });
  }, []);

  /// An in-place edit of one ticket, computed from whatever is on the board
  /// right now. Optimistic checkbox toggles use this so two quick ticks on the
  /// same order build on each other instead of clobbering from a stale copy.
  const patchTicket = useCallback(
    (id: string, update: (ticket: Ticket) => Ticket) => {
      setServerTickets((current) =>
        current.map((entry) => (entry.id === id ? update(entry) : entry)),
      );
    },
    [],
  );

  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) return refreshing.current;

    const job = (async () => {
      try {
        // Anything done offline goes up first, so the board we then fetch
        // already includes it.
        if (getOutbox().ops.length > 0) await drainOutbox();

        const [board, freshStats] = await Promise.all([
          api.board(),
          api.stats(),
        ]);

        const flat = LIVE.flatMap(
          (status) => board.columns[status as keyof typeof board.columns] ?? [],
        ).sort(byAge);

        setServerTickets(flat);
        setStats(freshStats);
        knownIds.current = new Set(flat.map((ticket) => ticket.id));
        setError(null);
      } catch (err) {
        // No connection is not an error on this screen: the offline banner
        // already says so, and the tickets on show are the last good ones.
        if (!(err instanceof ApiError && err.status === 0)) {
          setError(
            err instanceof Error ? err.message : 'Could not load the board.',
          );
        }
      } finally {
        setLoading(false);
      }
    })().finally(() => {
      refreshing.current = null;
    });

    refreshing.current = job;
    return job;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    void refresh();

    const setup = async () => {
      const socket = await connectKitchenSocket();
      if (disposed) return;

      const onConnect = () => {
        setSocketUp(true);
        // Catch up on anything missed while the socket was down.
        void refresh();
      };
      const onDisconnect = () => setSocketUp(false);

      const onCreated = (ticket: Ticket) => {
        if (!knownIds.current.has(ticket.id)) {
          knownIds.current.add(ticket.id);
          // This screen's own cashier already knows about the order.
          if (!isOwn(ticket.clientRef)) {
            playNewOrderChime();
            setNewIds((current) => new Set(current).add(ticket.id));
            // The arrival highlight is a nudge, not a permanent state.
            setTimeout(() => {
              setNewIds((current) => {
                const next = new Set(current);
                next.delete(ticket.id);
                return next;
              });
            }, 8000);
          }
        }
        applyTicket(ticket);
        void api.stats().then(setStats).catch(() => undefined);
      };

      const onUpdated = (ticket: Ticket) => {
        knownIds.current.add(ticket.id);
        applyTicket(ticket);
      };

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('order:created', onCreated);
      socket.on('order:updated', onUpdated);
      socket.on('order:status-changed', onUpdated);
      socket.on('order:cancelled', onUpdated);
      socket.on('order:item-status-changed', onUpdated);

      if (socket.connected) setSocketUp(true);
    };

    void setup();

    // Whatever the outbox gets through comes back as the server's own ticket.
    const stopTickets = onTicketSynced((ticket) => {
      knownIds.current.add(ticket.id);
      applyTicket(ticket);
    });
    // Once a batch is up, take a fresh look at the board and the counters.
    const stopDrained = onOutboxDrained(() => void refresh());
    const stopWorker = startOutboxWorker();

    return () => {
      disposed = true;
      stopTickets();
      stopDrained();
      stopWorker();
      disconnectKitchenSocket();
    };
  }, [enabled, refresh, applyTicket]);

  // The line coming back is the moment to catch up, whether or not the socket
  // has noticed yet.
  useEffect(() => {
    if (enabled && online) void refresh();
  }, [enabled, online, refresh]);

  // Keep a copy of the board for the next cold start with no connection.
  useEffect(() => {
    writeJson(BOARD_KEY, serverTickets);
  }, [serverTickets]);

  useEffect(() => {
    if (stats) writeJson(STATS_KEY, stats);
  }, [stats]);

  // Stats drift as tickets are bumped; a slow poll keeps the header honest
  // without a dedicated event for every counter.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void api.stats().then(setStats).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  // Plain derivations: the React compiler memoizes these, and wrapping them by
  // hand only gets in its way.
  const tickets = overlayTickets(serverTickets, outbox.ops)
    .filter((ticket) => LIVE.includes(ticket.status))
    .sort(byAge);

  const columns = {
    PENDING: tickets.filter((ticket) => ticket.status === 'PENDING'),
    CONFIRMED: tickets.filter((ticket) => ticket.status === 'CONFIRMED'),
    PREPARING: tickets.filter((ticket) => ticket.status === 'PREPARING'),
    READY: tickets.filter((ticket) => ticket.status === 'READY'),
  };

  return {
    tickets,
    columns,
    stats,
    connected: online && socketUp,
    loading,
    error,
    newIds,
    refresh,
    applyTicket,
    patchTicket,
  };
}
