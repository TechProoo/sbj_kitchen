import { useEffect, useState } from 'react';
import {
  LuCheck,
  LuMapPin,
  LuNavigation,
  LuPrinter,
  LuTriangleAlert,
  LuUtensils,
} from 'react-icons/lu';
import {
  TYPE_ICON,
  TYPE_LABEL,
  formatClock,
  formatElapsed,
  formatMoney,
  minutesSince,
} from '../lib/format';
import type { OrderStatus, Ticket as TicketModel } from '../lib/types';

/// Thresholds in minutes. A ticket goes amber then red so the pass can be read
/// at a glance without anyone doing arithmetic.
const WARM_AFTER = 10;
const LATE_AFTER = 20;

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING: 'Accept order',
  CONFIRMED: 'Start cooking',
  PREPARING: 'Mark ready',
  READY: 'Hand over',
};

function ageBand(minutes: number): 'fresh' | 'warm' | 'late' {
  if (minutes >= LATE_AFTER) return 'late';
  if (minutes >= WARM_AFTER) return 'warm';
  return 'fresh';
}

export function Ticket({
  ticket,
  isNew,
  busy,
  onAdvance,
  onToggleItem,
  onCancel,
  onPrint,
}: {
  ticket: TicketModel;
  isNew: boolean;
  busy: boolean;
  onAdvance: (ticket: TicketModel, next: OrderStatus) => void;
  onToggleItem: (ticket: TicketModel, itemId: string, done: boolean) => void;
  onCancel: (ticket: TicketModel) => void;
  /// Reprints the customer's paper ticket — lost slips, and collection
  /// orders that were paid online and need one when the customer arrives.
  onPrint: (ticket: TicketModel) => void;
}) {
  // The timer has to keep counting even when nothing else changes, so the
  // card re-renders on its own once a minute.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Time in the current stage matters more than time since the order landed:
  // a ticket that waited to be picked up should not read as a slow cook.
  const since =
    ticket.status === 'PREPARING' && ticket.startedAt
      ? ticket.startedAt
      : ticket.status === 'READY' && ticket.readyAt
        ? ticket.readyAt
        : ticket.placedAt;

  const minutes = minutesSince(since);
  const next = NEXT_STATUS[ticket.status];
  const TypeIcon = TYPE_ICON[ticket.type] ?? LuUtensils;

  return (
    <article
      className={`ticket${isNew ? ' is-new' : ''}`}
      data-age={ageBand(minutes)}
    >
      <div className="ticket-head">
        <div>
          <div className="ticket-number">{ticket.orderNumber}</div>
          <div className="ticket-sub">
            <TypeIcon className="ticket-type-icon" aria-hidden="true" />
            {TYPE_LABEL[ticket.type] ?? ticket.type}
            {ticket.tableNumber ? ` · Table ${ticket.tableNumber}` : ''}
            {' · '}
            {ticket.customerName}
          </div>
        </div>

        <div className="ticket-timer">
          <b>{formatElapsed(since)}</b>
          <span>{formatClock(ticket.placedAt)}</span>
        </div>
      </div>

      {ticket.type === 'DELIVERY' && ticket.address && (
        <div className="ticket-address">
          <LuMapPin aria-hidden="true" />
          <span className="ticket-address-text">
            {ticket.address.line1}
            {ticket.address.city ? `, ${ticket.address.city}` : ''}
            {ticket.address.landmark && (
              <em>{ticket.address.landmark}</em>
            )}
            {ticket.address.accuracyMeters !== null &&
              ticket.address.accuracyMeters > 500 && (
                <em className="ticket-address-warn">
                  Pin only accurate to ~{ticket.address.accuracyMeters}m — call
                  to confirm
                </em>
              )}
          </span>

          {/* A tap hands the rider turn-by-turn directions. No key, no map
              library — the pin is the whole of what they need. */}
          {ticket.address.latitude && ticket.address.longitude && (
            <a
              className="ticket-map"
              href={`https://www.google.com/maps/dir/?api=1&destination=${ticket.address.latitude},${ticket.address.longitude}`}
              target="_blank"
              rel="noreferrer"
              title="Open directions to this pin"
            >
              <LuNavigation aria-hidden="true" />
              Directions
            </a>
          )}
        </div>
      )}

      <div className="ticket-items">
        {ticket.items.map((item) => {
          const done = item.status === 'READY' || item.status === 'SERVED';
          return (
            <button
              key={item.id}
              type="button"
              className="ticket-item"
              data-done={done}
              onClick={() => onToggleItem(ticket, item.id, !done)}
              disabled={busy}
            >
              <span className="qty">{item.quantity}×</span>
              <span className="body">
                <span className="name">{item.nameSnapshot}</span>
                {item.modifiers.length > 0 && (
                  <span className="mods">
                    {item.modifiers.map((m) => m.nameSnapshot).join(' · ')}
                  </span>
                )}
                {item.notes && (
                  <span className="note">
                    <LuTriangleAlert aria-hidden="true" />
                    {item.notes}
                  </span>
                )}
              </span>
              <span className="check" aria-hidden="true">
                {done && <LuCheck />}
              </span>
            </button>
          );
        })}
      </div>

      {ticket.notes && (
        <p className="ticket-note">
          <LuTriangleAlert aria-hidden="true" />
          {ticket.notes}
        </p>
      )}

      <div className="ticket-foot">
        <div className="ticket-meta">
          <span
            className={`badge ${
              ticket.paymentStatus === 'PAID' ? 'badge-paid' : 'badge-unpaid'
            }`}
          >
            {ticket.paymentStatus}
          </span>
          <span>{formatMoney(ticket.total)}</span>
          {ticket.claimedBy && <span>· {ticket.claimedBy.fullName}</span>}

          <button
            type="button"
            className="ticket-print"
            onClick={() => onPrint(ticket)}
            aria-label={`Print ticket ${ticket.orderNumber}`}
            title="Print the customer's ticket"
          >
            <LuPrinter aria-hidden="true" />
          </button>
        </div>

        {next && (
          <button
            type="button"
            className={`btn btn-bump to-${next.toLowerCase()}`}
            onClick={() => onAdvance(ticket, next)}
            disabled={busy}
          >
            {NEXT_LABEL[ticket.status]}
          </button>
        )}

        {ticket.status === 'PENDING' && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onCancel(ticket)}
            disabled={busy}
          >
            Cancel order
          </button>
        )}
      </div>
    </article>
  );
}
