import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuBookOpen,
  LuChartColumn,
  LuCloudOff,
  LuPlus,
  LuRefreshCw,
} from 'react-icons/lu';
import { Ticket as TicketCard } from '../components/Ticket';
import { NewOrderSheet } from '../components/NewOrderSheet';
import { PrintTicket } from '../components/PrintTicket';
import { SoldOutSheet } from '../components/SoldOutSheet';
import { CancelSheet } from '../components/CancelSheet';
import { SyncSheet } from '../components/SyncSheet';
import { useAuth } from '../context/AuthContext';
import { useBoard } from '../hooks/useBoard';
import { api, ApiError } from '../lib/api';
import { isOnline, useOnline } from '../lib/connectivity';
import { formatMoney } from '../lib/format';
import {
  advanceLocal,
  isLocalTicket,
  queueCancel,
  queueItem,
  queueStatus,
  toggleLocalItem,
  useOutbox,
} from '../lib/outbox';
import type { OrderItemStatus, OrderStatus, Ticket } from '../lib/types';

const COLUMNS: { status: keyof ReturnType<typeof useBoard>['columns']; label: string }[] =
  [
    { status: 'PENDING', label: 'New' },
    { status: 'CONFIRMED', label: 'Accepted' },
    { status: 'PREPARING', label: 'Cooking' },
    { status: 'READY', label: 'Ready' },
  ];

export function BoardPage() {
  const { user, signOut } = useAuth();
  const board = useBoard(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Ticket | null>(null);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const [takingOrder, setTakingOrder] = useState(false);
  const [printing, setPrinting] = useState<Ticket | null>(null);
  const [showSync, setShowSync] = useState(false);

  const online = useOnline();
  const outbox = useOutbox();
  const waiting = outbox.ops.length;
  const refused = outbox.ops.filter(
    (op) => op.kind === 'create' && op.failed,
  ).length;

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /// Every mutation goes through here so the card locks while the request is
  /// in flight — double-bumping a ticket in a busy kitchen is easy to do.
  ///
  /// With no connection the change is saved to the outbox instead and the board
  /// shows it straight away; `offline` is what gets saved.
  const run = useCallback(
    async (
      id: string,
      action: () => Promise<Ticket | unknown>,
      offline?: () => void,
    ) => {
      setActionError(null);

      if (offline && !isOnline()) {
        offline();
        return;
      }

      setBusy(id, true);
      try {
        const updated = (await action()) as Ticket;
        if (updated?.id) board.applyTicket(updated);
      } catch (error) {
        if (offline && error instanceof ApiError && error.status === 0) {
          offline();
          return;
        }
        setActionError(
          error instanceof ApiError ? error.message : 'That did not go through.',
        );
        // Re-sync rather than leave the board showing a state the server rejected.
        void board.refresh();
      } finally {
        setBusy(id, false);
      }
    },
    [board, setBusy],
  );

  const advance = (ticket: Ticket, next: OrderStatus) => {
    // A ticket taken offline has no server order yet; it moves on this device
    // and the steps are replayed once it is uploaded.
    if (isLocalTicket(ticket)) {
      advanceLocal(ticket.id, next);
      return;
    }
    void run(
      ticket.id,
      () => api.setStatus(ticket.id, next),
      () => queueStatus(ticket.id, next),
    );
  };

  // Ticking an item is optimistic and deliberately stays off the card's busy
  // lock: the check flips instantly and the Accept / advance button never waits
  // on the round-trip. The backend changes only this one item, so there is
  // nothing else to reconcile on success — a failure just refreshes the board
  // back to the truth.
  const toggleItem = async (ticket: Ticket, itemId: string, done: boolean) => {
    const status: OrderItemStatus = done ? 'READY' : 'QUEUED';
    setActionError(null);

    if (isLocalTicket(ticket)) {
      toggleLocalItem(ticket.id, itemId, status);
      return;
    }
    if (!isOnline()) {
      queueItem(ticket.id, itemId, status);
      return;
    }

    board.patchTicket(ticket.id, (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      ),
    }));
    try {
      await api.setItemStatus(ticket.id, itemId, status);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        queueItem(ticket.id, itemId, status);
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : 'That did not go through.',
      );
      void board.refresh();
    }
  };

  const confirmCancel = async (reason: string) => {
    if (!cancelling) return;
    const ticket = cancelling;
    setCancelling(null);
    await run(
      ticket.id,
      () => api.cancel(ticket.id, reason),
      () => queueCancel(ticket.id, reason),
    );
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <img
            className="mark"
            src="/brand/sbj-logo.png"
            alt=""
            width={34}
            height={34}
          />
          <span>
            Kitchen Display
            <small>Foods &amp; Drinks</small>
          </span>
        </div>

        {board.stats && (
          <div className="stat-strip">
            {/* Counted from the tickets on screen, so they stay true offline. */}
            <div className="stat">
              <b>{board.columns.PENDING.length + board.columns.CONFIRMED.length}</b>
              <span>Waiting</span>
            </div>
            <div className="stat">
              <b>{board.columns.PREPARING.length}</b>
              <span>Cooking</span>
            </div>
            <div className="stat">
              <b>{board.columns.READY.length}</b>
              <span>Ready</span>
            </div>
            <div className="stat">
              <b>
                {board.stats.today.averagePrepMinutes !== null
                  ? `${board.stats.today.averagePrepMinutes}m`
                  : '—'}
              </b>
              <span>Avg prep</span>
            </div>
            <div className="stat">
              <b>{formatMoney(board.stats.today.revenue)}</b>
              <span>Today</span>
            </div>
          </div>
        )}

        <div className="topbar-right">
          <span className={`conn${board.connected ? '' : ' offline'}`}>
            {!online ? 'Offline' : board.connected ? 'Live' : 'Reconnecting'}
          </span>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setTakingOrder(true)}
          >
            <LuPlus aria-hidden="true" />
            New order
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowSoldOut(true)}
            disabled={!online}
            title={online ? undefined : 'Needs a connection'}
          >
            Sold out
          </button>

          {/* The panel is the owner's, so the way in only shows for them. */}
          {user?.role === 'KITCHEN' && (
            <Link to="/admin/menu" className="btn btn-ghost">
              <LuBookOpen aria-hidden="true" />
              Menu
            </Link>
          )}

          {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
            <Link to="/admin/panel" className="btn btn-ghost">
              <LuChartColumn aria-hidden="true" />
              Sales
            </Link>
          )}

          <div className="who">
            <b>{user?.fullName ?? user?.email}</b>
            <span>{user?.role}</span>
          </div>

          <button type="button" className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* Quiet on purpose: it appears only when something needs saying, sends
          by itself, and asks for a tap only when the server refused an order. */}
      {(!online || waiting > 0) && (
        <div
          className={`netbar${!online ? ' is-offline' : ''}${refused > 0 ? ' is-refused' : ''}`}
          role="status"
        >
          {!online ? (
            <LuCloudOff aria-hidden="true" />
          ) : (
            <LuRefreshCw
              aria-hidden="true"
              className={outbox.syncing ? 'spin' : ''}
            />
          )}

          <p>
            {refused > 0
              ? `${refused} ${refused === 1 ? 'order needs' : 'orders need'} attention`
              : !online
                ? waiting > 0
                  ? `Offline · ${waiting} saved, sending when back`
                  : 'Offline · orders are saved and sent when back'
                : `Sending ${waiting}…`}
          </p>

          {(refused > 0 || waiting > 0) && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowSync(true)}
            >
              View
            </button>
          )}
        </div>
      )}

      {(board.error || actionError) && (
        <div className="alert" style={{ margin: '12px 24px 0' }}>
          {actionError ?? board.error}
        </div>
      )}

      <div className="board">
        {COLUMNS.map(({ status, label }) => {
          const tickets = board.columns[status];
          return (
            <section key={status} className="column" data-status={status}>
              <div className="column-head">
                <span className="dot" aria-hidden="true" />
                <h2>{label}</h2>
                <span className="count">{tickets.length}</span>
              </div>

              <div className="column-body">
                {board.loading && tickets.length === 0 && (
                  <p className="column-empty">Loading…</p>
                )}

                {!board.loading && tickets.length === 0 && (
                  <p className="column-empty">Nothing here.</p>
                )}

                {tickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    isNew={board.newIds.has(ticket.id)}
                    busy={busyIds.has(ticket.id)}
                    onAdvance={advance}
                    onToggleItem={toggleItem}
                    onCancel={setCancelling}
                    onPrint={setPrinting}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {cancelling && (
        <CancelSheet
          ticket={cancelling}
          onClose={() => setCancelling(null)}
          onConfirm={confirmCancel}
        />
      )}

      {showSoldOut && <SoldOutSheet onClose={() => setShowSoldOut(false)} />}

      {takingOrder && (
        <NewOrderSheet
          onClose={() => setTakingOrder(false)}
          onPlaced={(ticket) => {
            // The socket will deliver it too; applying it here means the
            // ticket is on the board before the cashier looks up. The sheet
            // stays open on its printing step.
            board.applyTicket(ticket);
          }}
        />
      )}

      {showSync && <SyncSheet onClose={() => setShowSync(false)} />}

      {printing && (
        <PrintTicket ticket={printing} onDone={() => setPrinting(null)} />
      )}
    </>
  );
}
