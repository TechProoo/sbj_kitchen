import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuChartColumn, LuPlus } from 'react-icons/lu';
import { Ticket as TicketCard } from '../components/Ticket';
import { NewOrderSheet } from '../components/NewOrderSheet';
import { PrintTicket } from '../components/PrintTicket';
import { SoldOutSheet } from '../components/SoldOutSheet';
import { CancelSheet } from '../components/CancelSheet';
import { useAuth } from '../context/AuthContext';
import { useBoard } from '../hooks/useBoard';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { OrderStatus, Ticket } from '../lib/types';

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
  const run = useCallback(
    async (id: string, action: () => Promise<Ticket | unknown>) => {
      setBusy(id, true);
      setActionError(null);
      try {
        const updated = (await action()) as Ticket;
        if (updated?.id) board.applyTicket(updated);
      } catch (error) {
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

  const advance = (ticket: Ticket, next: OrderStatus) =>
    run(ticket.id, () => api.setStatus(ticket.id, next));

  const toggleItem = (ticket: Ticket, itemId: string, done: boolean) =>
    run(ticket.id, () =>
      api.setItemStatus(ticket.id, itemId, done ? 'READY' : 'QUEUED'),
    );

  const confirmCancel = async (reason: string) => {
    if (!cancelling) return;
    const ticket = cancelling;
    setCancelling(null);
    await run(ticket.id, () => api.cancel(ticket.id, reason));
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <img
            className="mark"
            src="/brand/sbj-logo.jpg"
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
            <div className="stat">
              <b>{board.stats.live.pending + board.stats.live.confirmed}</b>
              <span>Waiting</span>
            </div>
            <div className="stat">
              <b>{board.stats.live.preparing}</b>
              <span>Cooking</span>
            </div>
            <div className="stat">
              <b>{board.stats.live.ready}</b>
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
            {board.connected ? 'Live' : 'Reconnecting'}
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
          >
            Sold out
          </button>

          {/* The panel is the owner's, so the way in only shows for them. */}
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

      {printing && (
        <PrintTicket ticket={printing} onDone={() => setPrinting(null)} />
      )}
    </>
  );
}
