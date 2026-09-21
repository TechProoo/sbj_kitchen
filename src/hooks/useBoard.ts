import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { playNewOrderChime } from '../lib/chime';
import { connectKitchenSocket, disconnectKitchenSocket } from '../lib/socket';
import type { KitchenStats, OrderStatus, Ticket } from '../lib/types';

const LIVE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

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
}

/// Owns the board's live state: one REST fetch for the initial paint, then
/// socket events patch individual tickets. A full refetch happens on reconnect,
/// because anything could have changed while the screen was offline.
export function useBoard(enabled: boolean): BoardState {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<KitchenStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  // Refs so the socket handlers, registered once, never read stale state.
  const knownIds = useRef<Set<string>>(new Set());

  const applyTicket = useCallback((ticket: Ticket) => {
    setTickets((current) => {
      const withoutIt = current.filter((entry) => entry.id !== ticket.id);
      // A completed or cancelled ticket leaves the board entirely.
      if (!LIVE.includes(ticket.status)) return withoutIt;
      return [...withoutIt, ticket].sort(
        (a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt),
      );
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [board, freshStats] = await Promise.all([
        api.board(),
        api.stats(),
      ]);

      const flat = LIVE.flatMap(
        (status) => board.columns[status as keyof typeof board.columns] ?? [],
      ).sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt));

      setTickets(flat);
      setStats(freshStats);
      knownIds.current = new Set(flat.map((ticket) => ticket.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    void refresh();

    const setup = async () => {
      const socket = await connectKitchenSocket();
      if (disposed) return;

      const onConnect = () => {
        setConnected(true);
        // Catch up on anything missed while the socket was down.
        void refresh();
      };
      const onDisconnect = () => setConnected(false);

      const onCreated = (ticket: Ticket) => {
        if (!knownIds.current.has(ticket.id)) {
          knownIds.current.add(ticket.id);
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

      if (socket.connected) setConnected(true);
    };

    void setup();

    return () => {
      disposed = true;
      disconnectKitchenSocket();
    };
  }, [enabled, refresh, applyTicket]);

  // Stats drift as tickets are bumped; a slow poll keeps the header honest
  // without a dedicated event for every counter.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void api.stats().then(setStats).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  const columns = useMemo(
    () => ({
      PENDING: tickets.filter((ticket) => ticket.status === 'PENDING'),
      CONFIRMED: tickets.filter((ticket) => ticket.status === 'CONFIRMED'),
      PREPARING: tickets.filter((ticket) => ticket.status === 'PREPARING'),
      READY: tickets.filter((ticket) => ticket.status === 'READY'),
    }),
    [tickets],
  );

  return {
    tickets,
    columns,
    stats,
    connected,
    loading,
    error,
    newIds,
    refresh,
    applyTicket,
  };
}
