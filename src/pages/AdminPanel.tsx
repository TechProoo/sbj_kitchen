import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuArrowLeft,
  LuBanknote,
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuClock,
  LuReceipt,
  LuRefreshCw,
  LuTriangleAlert,
  LuUsers,
} from 'react-icons/lu';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { formatClock, formatMoney, TYPE_LABEL } from '../lib/format';
import type { AdminOverview } from '../lib/types';

/// The panel polls rather than holding a socket: sales figures do not need
/// to be sub-second, and a quiet refresh survives a laptop lid being closed.
const REFRESH_MS = 60_000;

function today(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + by);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/// Bars are drawn as plain divs against the tallest value in the set — a
/// chart library would be four hundred kilobytes for eight rectangles.
function peak(values: number[]): number {
  return Math.max(1, ...values);
}

export function AdminPanel() {
  const { user } = useAuth();
  const [day, setDay] = useState(today());
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  /// Nothing is set synchronously here: the report only lands once the request
  /// resolves, so switching day never blanks the screen mid-render.
  const refresh = useCallback(
    (target: string) =>
      api
        .overview(target)
        .then((overview) => {
          setData(overview);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            err instanceof ApiError ? err.message : 'Could not load the report.',
          );
        }),
    [],
  );

  useEffect(() => {
    void refresh(day);
  }, [day, refresh]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(day), REFRESH_MS);
    return () => clearInterval(timer);
  }, [day, refresh]);

  /// Derived rather than stored: the panel is loading precisely while the
  /// report on screen is not the day being asked for.
  const loading = !error && (!data || data.day !== day);
  const sales = data?.sales;
  const isFuture = day >= today();

  return (
    <div className="panel">
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
            Owner&apos;s Panel
            <small>Everything the restaurant is doing</small>
          </span>
        </div>

        <div className="topbar-right">
          <Link to="/" className="btn btn-ghost">
            <LuArrowLeft aria-hidden="true" />
            Kitchen board
          </Link>

          <div className="who">
            <b>{user?.fullName ?? user?.email}</b>
            <span>{user?.role}</span>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------- day picker */}

      <div className="panel-daybar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setDay(shiftDay(day, -1))}
          aria-label="Previous day"
        >
          <LuChevronLeft aria-hidden="true" />
        </button>

        <div className="panel-day">
          <b>{longDay(day)}</b>
          <span>
            {data?.isToday ? 'Today, live' : 'Closed day'}
            {data && ` · report as of ${formatClock(data.asOf)}`}
          </span>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setDay(shiftDay(day, 1))}
          disabled={isFuture}
          aria-label="Next day"
        >
          <LuChevronRight aria-hidden="true" />
        </button>

        <input
          type="date"
          className="panel-date-input"
          value={day}
          max={today()}
          onChange={(event) => setDay(event.target.value || today())}
          aria-label="Pick a day"
        />

        {!isFuture && day !== today() && (
          <button type="button" className="btn btn-ghost" onClick={() => setDay(today())}>
            Today
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost panel-refresh"
          onClick={() => void refresh(day)}
          aria-label="Refresh"
        >
          <LuRefreshCw aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div className="alert panel-alert">
          <LuTriangleAlert aria-hidden="true" />
          {error}
        </div>
      )}

      {loading && <p className="panel-loading">Adding up the day…</p>}

      {data && sales && data.day === day && (
        <div className="panel-body">
          {/* ------------------------------------------------- headline row */}

          <section className="kpi-row">
            <div className="kpi kpi-lead">
              <span className="kpi-label">
                <LuBanknote aria-hidden="true" /> Sales
              </span>
              <b>{formatMoney(sales.revenue)}</b>
              <small>
                {sales.orders} {sales.orders === 1 ? 'order' : 'orders'} ·{' '}
                {formatMoney(sales.averageOrder)} average
              </small>
            </div>

            <div className="kpi">
              <span className="kpi-label">Collected</span>
              <b>{formatMoney(sales.collected)}</b>
              <small>
                {Number(sales.outstanding) > 0
                  ? `${formatMoney(sales.outstanding)} still owed`
                  : 'All settled'}
              </small>
            </div>

            <div className="kpi">
              <span className="kpi-label">Completed</span>
              <b>{sales.completedOrders}</b>
              <small>
                {sales.averagePrepMinutes !== null
                  ? `${sales.averagePrepMinutes} min average prep`
                  : 'No prep times recorded'}
              </small>
            </div>

            <div className="kpi">
              <span className="kpi-label">Cancelled</span>
              <b>{sales.cancelledOrders}</b>
              <small>{formatMoney(sales.cancelledValue)} not taken</small>
            </div>

            <div className="kpi">
              <span className="kpi-label">On the board now</span>
              <b>{data.live.total}</b>
              <small>
                {data.live.byStatus.length > 0
                  ? data.live.byStatus
                      .map((row) => `${row.orders} ${row.status.toLowerCase()}`)
                      .join(' · ')
                  : 'Nothing cooking'}
              </small>
            </div>
          </section>

          <div className="panel-grid">
            {/* ------------------------------------------------ hourly sales */}

            <section className="card card-wide">
              <h2>
                <LuClock aria-hidden="true" /> Sales through the day
              </h2>

              {sales.orders === 0 ? (
                <p className="muted">No orders on this day.</p>
              ) : (
                <div className="bars">
                  {data.hours.map((slot) => {
                    const top = peak(data.hours.map((h) => Number(h.revenue)));
                    return (
                      <div
                        key={slot.hour}
                        className="bar"
                        title={`${String(slot.hour).padStart(2, '0')}:00 — ${formatMoney(
                          slot.revenue,
                        )} from ${slot.orders} ${slot.orders === 1 ? 'order' : 'orders'}`}
                      >
                        <span
                          className="bar-fill"
                          style={{
                            height: `${(Number(slot.revenue) / top) * 100}%`,
                          }}
                        />
                        {slot.hour % 3 === 0 && (
                          <i>{String(slot.hour).padStart(2, '0')}</i>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ----------------------------------------------- week trend */}

            <section className="card">
              <h2>Last seven days</h2>
              <ul className="rows">
                {data.days.map((entry) => {
                  const top = peak(data.days.map((d) => Number(d.revenue)));
                  return (
                    <li key={entry.day}>
                      <span className="rows-name">
                        {new Date(`${entry.day}T00:00:00`).toLocaleDateString(
                          'en-NG',
                          { weekday: 'short', day: 'numeric' },
                        )}
                      </span>
                      <span className="rows-track">
                        <span
                          className="rows-fill"
                          style={{ width: `${(Number(entry.revenue) / top) * 100}%` }}
                        />
                      </span>
                      <b>{formatMoney(entry.revenue)}</b>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ------------------------------------------------- top dishes */}

            <section className="card">
              <h2>What sold</h2>
              {data.topItems.length === 0 ? (
                <p className="muted">Nothing sold on this day.</p>
              ) : (
                <ul className="rows">
                  {data.topItems.map((item) => {
                    const top = peak(data.topItems.map((i) => Number(i.revenue)));
                    return (
                      <li key={item.name}>
                        <span className="rows-name" title={item.name}>
                          {item.name}
                          <i>×{item.quantity}</i>
                        </span>
                        <span className="rows-track">
                          <span
                            className="rows-fill"
                            style={{ width: `${(Number(item.revenue) / top) * 100}%` }}
                          />
                        </span>
                        <b>{formatMoney(item.revenue)}</b>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* -------------------------------------------------- breakdowns */}

            <section className="card">
              <h2>How they ordered</h2>
              <table className="mini">
                <tbody>
                  {data.byType.map((row) => (
                    <tr key={row.type}>
                      <th>{TYPE_LABEL[row.type] ?? row.type}</th>
                      <td>{row.orders}</td>
                      <td>{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                  {data.byType.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        Nothing yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h2 className="card-subhead">How they paid</h2>
              <table className="mini">
                <tbody>
                  {data.byPaymentMethod.map((row) => (
                    <tr key={row.method ?? 'unset'}>
                      <th>{row.method ?? 'Not recorded'}</th>
                      <td>{row.orders}</td>
                      <td>{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                  {data.byPaymentMethod.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        Nothing yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* ------------------------------------------------ kitchen state */}

            <section className="card">
              <h2>
                <LuCircleAlert aria-hidden="true" /> Off the menu
              </h2>
              <p className="muted">
                {data.menu.available} dishes available · {data.menu.soldOut} sold out
              </p>
              {data.menu.soldOutItems.length > 0 && (
                <ul className="chips">
                  {data.menu.soldOutItems.map((item) => (
                    <li key={item.id}>
                      {item.name}
                      <i>{item.category}</i>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="card-subhead">
                <LuUsers aria-hidden="true" /> Staff
              </h2>
              <ul className="chips">
                {data.staff.map((person) => (
                  <li key={person.id} className={person.isActive ? '' : 'is-off'}>
                    {person.fullName ?? person.email}
                    <i>{person.role}</i>
                  </li>
                ))}
              </ul>
            </section>

            {/* ------------------------------------------------ recent orders */}

            <section className="card card-wide">
              <h2>
                <LuReceipt aria-hidden="true" /> Orders on this day
              </h2>

              {data.recent.length === 0 ? (
                <p className="muted">No orders on this day.</p>
              ) : (
                <div className="table-scroll">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Placed</th>
                        <th>Customer</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Taken by</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((order) => (
                        <tr key={order.id}>
                          <th>{order.orderNumber}</th>
                          <td>{formatClock(order.placedAt)}</td>
                          <td>{order.customerName}</td>
                          <td>{TYPE_LABEL[order.type] ?? order.type}</td>
                          <td>
                            <span className={`pill status-${order.status.toLowerCase()}`}>
                              {order.status}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`pill ${
                                order.paymentStatus === 'PAID' ? 'is-paid' : 'is-unpaid'
                              }`}
                            >
                              {order.paymentStatus}
                              {order.paymentMethod ? ` · ${order.paymentMethod}` : ''}
                            </span>
                          </td>
                          <td>{order.claimedBy ?? '—'}</td>
                          <td className="num">{formatMoney(order.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.recent.length >= 25 && (
                <p className="muted">Showing the 25 most recent tickets of this day.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
