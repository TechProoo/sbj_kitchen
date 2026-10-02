import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LuBanknote,
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuClock,
  LuCloudOff,
  LuCloudUpload,
  LuRefreshCw,
  LuTriangleAlert,
  LuUsers,
} from 'react-icons/lu';
import { AdminTabs } from '../components/AdminTabs';
import { BouncingDots } from '../components/BouncingDots';
import { OrderLedger } from '../components/OrderLedger';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { useOnline } from '../lib/connectivity';
import { isUnpaid, type LedgerFilter } from '../lib/ledger';
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

type View = 'overview' | 'orders' | 'details';

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'details', label: 'Menu & team' },
];

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
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((entry) => entry.id === params.get('view'))
    ? (params.get('view') as View)
    : 'overview';
  const setView = (next: View) =>
    setParams(next === 'overview' ? {} : { view: next }, { replace: true });
  const online = useOnline();

  /// Nothing is set synchronously here: the report only lands once the request
  /// resolves, so switching day never blanks the screen mid-render.
  const refresh = useCallback(
    (target: string, quiet = false) =>
      api
        .overview(target, quiet)
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
    const timer = setInterval(() => void refresh(day, true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [day, refresh]);

  /// Derived rather than stored: the panel is loading precisely while the
  /// report on screen is not the day being asked for.
  const loading = !error && (!data || data.day !== day);
  const sales = data?.sales;
  const isFuture = day >= today();
  const unpaid = data ? data.recent.filter(isUnpaid) : [];
  const unpaidValue = unpaid.reduce((sum, order) => sum + Number(order.total), 0);
  const yesterday = shiftDay(today(), -1);

  /// Jumping to a day also clears any filter left over from the last one.
  const openDay = (target: string) => {
    setDay(target);
    setFilter('all');
  };

  return (
    <div className="panel">
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
            Owner&apos;s Panel
            <small>Everything the restaurant is doing</small>
          </span>
        </div>

        <div className="topbar-right">
          <div className="who">
            <b>{user?.fullName ?? user?.email}</b>
            <span>{user?.role}</span>
          </div>
        </div>
      </header>

      <AdminTabs />

      {/* ------------------------------------------------------- day picker */}

      <div className="panel-daybar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => openDay(shiftDay(day, -1))}
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
          onClick={() => openDay(shiftDay(day, 1))}
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
          onChange={(event) => openDay(event.target.value || today())}
          aria-label="Pick a day"
        />

        {day !== today() && (
          <button type="button" className="btn btn-ghost" onClick={() => openDay(today())}>
            Today
          </button>
        )}

        {day !== yesterday && (
          <button type="button" className="btn btn-ghost" onClick={() => openDay(yesterday)}>
            Yesterday
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost panel-refresh"
          onClick={() => void refresh(day)}
          aria-label="Refresh"
          title={online ? 'Refresh' : 'No internet'}
        >
          <LuRefreshCw aria-hidden="true" />
        </button>
      </div>

      {data?.fromCache && (
        <div className="alert alert-info panel-alert">
          <LuCloudOff aria-hidden="true" />
          No internet. These are the figures saved at {formatClock(data.asOf)}.
          They update by themselves once the connection is back.
        </div>
      )}

      {error && (
        <div className="alert panel-alert">
          <LuTriangleAlert aria-hidden="true" />
          {error}
        </div>
      )}

      {loading && (
        <p className="panel-loading">
          <BouncingDots label="Adding up the day" /> Adding up the day…
        </p>
      )}

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

          {/* ------------------------------------------------- needs a look */}

          {(unpaid.length > 0 || data.offline.orders > 0) && (
            <section className="attention" aria-label="Needs attention">
              {unpaid.length > 0 && (
                <button
                  type="button"
                  className="attention-item is-warn"
                  onClick={() => {
                    setFilter('unpaid');
                    setView('orders');
                  }}
                >
                  <LuBanknote aria-hidden="true" />
                  <span>
                    <b>
                      {unpaid.length} unpaid {unpaid.length === 1 ? 'order' : 'orders'}
                    </b>
                    {formatMoney(unpaidValue)} not yet collected
                  </span>
                </button>
              )}

              {data.offline.orders > 0 && (
                <button
                  type="button"
                  className="attention-item"
                  onClick={() => {
                    setFilter('offline');
                    setView('orders');
                  }}
                >
                  <LuCloudUpload aria-hidden="true" />
                  <span>
                    <b>
                      {data.offline.orders} taken offline
                    </b>
                    {formatMoney(data.offline.revenue)} sent up after the internet dropped
                  </span>
                </button>
              )}
            </section>
          )}

          {/* ---------------------------------------------------- the views */}

          <div className="view-tabs" role="tablist" aria-label="Sales sections">
            {VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={view === entry.id}
                className={view === entry.id ? 'is-on' : ''}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
                {entry.id === 'orders' && <i>{data.recent.length}</i>}
              </button>
            ))}
          </div>

          {view === 'overview' && (
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
                      <button
                        type="button"
                        className={`rows-name rows-link${entry.day === day ? ' is-picked' : ''}`}
                        onClick={() => openDay(entry.day)}
                        title="Open this day"
                      >
                        {new Date(`${entry.day}T00:00:00`).toLocaleDateString(
                          'en-NG',
                          { weekday: 'short', day: 'numeric' },
                        )}
                      </button>
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

            </div>
          )}

          {view === 'orders' && (
            <div className="panel-grid">
            {/* ------------------------------------------------ recent orders */}

            <section className="card card-wide card-flush">
              <OrderLedger
                day={day}
                orders={data.recent}
                filter={filter}
                onFilter={setFilter}
                onChanged={() => void refresh(day)}
              />
            </section>
            </div>
          )}

          {view === 'details' && (
            <div className="panel-grid">
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

            </div>
          )}
        </div>
      )}
    </div>
  );
}
