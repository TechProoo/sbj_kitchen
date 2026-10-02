import { Fragment, useMemo, useState } from 'react';
import {
  LuBanknote,
  LuChevronDown,
  LuCloudUpload,
  LuDownload,
  LuSearch,
} from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { useOnline } from '../lib/connectivity';
import { formatClock, formatMoney, TYPE_LABEL } from '../lib/format';
import {
  isUnpaid,
  matchesFilter,
  type LedgerFilter,
  type Order,
} from '../lib/ledger';

const FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'offline', label: 'Taken offline' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'DINE_IN', label: 'Dine in' },
];

const METHODS = ['CASH', 'CARD', 'TRANSFER'] as const;

function matchesSearch(order: Order, term: string): boolean {
  if (!term) return true;
  const haystack = [
    order.orderNumber,
    order.offlineRef,
    order.customerName,
    order.customerPhone,
    order.tableNumber,
    order.claimedBy,
    ...order.items.map((item) => item.nameSnapshot),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/// A spreadsheet treats a cell starting with = + - @ as a formula, and a
/// customer's name is whatever they typed.
function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(day: string, orders: Order[]): void {
  const header = [
    'Ticket',
    'Placed',
    'Customer',
    'Phone',
    'Type',
    'Table',
    'Status',
    'Payment',
    'Method',
    'Channel',
    'Offline slip',
    'Taken by',
    'Total',
    'Items',
  ];

  const rows = orders.map((order) => [
    order.orderNumber,
    new Date(order.placedAt).toLocaleString('en-NG'),
    order.customerName,
    order.customerPhone,
    TYPE_LABEL[order.type] ?? order.type,
    order.tableNumber,
    order.status,
    order.paymentStatus,
    order.paymentMethod,
    order.channel,
    order.offlineRef,
    order.claimedBy,
    Number(order.total),
    order.items.map((item) => `${item.quantity}x ${item.nameSnapshot}`).join('; '),
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((value) => cell(value)).join(','))
    .join('\r\n');

  // The BOM makes Excel read the file as UTF-8 rather than guessing.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sbj-orders-${day}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/*
 * The day's tickets, made searchable.
 *
 * The panel used to show the latest 25 and stop. A day's worth is loaded in
 * one go now, and finding "the lady who paid by transfer" or "everything still
 * unpaid" is a filter and a word, not a scroll.
 */
export function OrderLedger({
  day,
  orders,
  filter,
  onFilter,
  onChanged,
}: {
  day: string;
  orders: Order[];
  filter: LedgerFilter;
  onFilter: (filter: LedgerFilter) => void;
  onChanged: () => void;
}) {
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ value }) => [
          value,
          orders.filter((order) => matchesFilter(order, value)).length,
        ]),
      ) as Record<LedgerFilter, number>,
    [orders],
  );

  const shown = useMemo(
    () =>
      orders.filter(
        (order) => matchesFilter(order, filter) && matchesSearch(order, query.trim()),
      ),
    [orders, filter, query],
  );

  const total = shown
    .filter((order) => order.status !== 'CANCELLED')
    .reduce((sum, order) => sum + Number(order.total), 0);

  const collect = async (order: Order, method: (typeof METHODS)[number]) => {
    setPayingId(order.id);
    setError(null);
    try {
      await api.setPayment(order.id, 'PAID', method);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not mark it paid.',
      );
    } finally {
      setPayingId(null);
    }
  };

  return (
    <>
      <div className="ledger-tools">
        <label className="ledger-search">
          <LuSearch aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ticket, name, phone or dish"
            aria-label="Search the day's orders"
          />
        </label>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => downloadCsv(day, shown)}
          disabled={shown.length === 0}
        >
          <LuDownload aria-hidden="true" />
          Download CSV
        </button>
      </div>

      <div className="filter-chips" role="group" aria-label="Filter orders">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'is-on' : ''}
            onClick={() => onFilter(value)}
            aria-pressed={filter === value}
          >
            {label}
            <i>{counts[value]}</i>
          </button>
        ))}
      </div>

      {error && <div className="alert">{error}</div>}

      {shown.length === 0 ? (
        <p className="muted">
          {orders.length === 0
            ? 'No orders on this day.'
            : 'No orders match. Clear the search or pick a different filter.'}
        </p>
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
                <th className="num">Total</th>
                <th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {shown.map((order) => {
                const open = openId === order.id;
                return (
                  <Fragment key={order.id}>
                    <tr
                      className={`ledger-row${open ? ' is-open' : ''}`}
                      onClick={() => setOpenId(open ? null : order.id)}
                    >
                      <th>
                        {order.orderNumber}
                        {order.syncedAt && (
                          <span
                            className="tag-offline"
                            title={`Taken offline${order.offlineRef ? ` as ${order.offlineRef}` : ''}, sent at ${formatClock(order.syncedAt)}`}
                          >
                            <LuCloudUpload aria-hidden="true" /> Offline
                          </span>
                        )}
                      </th>
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
                      <td className="num">{formatMoney(order.total)}</td>
                      <td className="ledger-more">
                        <LuChevronDown aria-hidden="true" />
                      </td>
                    </tr>

                    {open && (
                      <tr className="ledger-detail">
                        <td colSpan={8}>
                          <div className="detail-grid">
                            <ul className="detail-items">
                              {order.items.map((item, index) => (
                                <li key={`${item.nameSnapshot}-${index}`}>
                                  <b>{item.quantity}×</b> {item.nameSnapshot}
                                </li>
                              ))}
                            </ul>

                            <dl className="detail-facts">
                              {order.customerPhone && (
                                <>
                                  <dt>Phone</dt>
                                  <dd>
                                    <a href={`tel:${order.customerPhone}`}>
                                      {order.customerPhone}
                                    </a>
                                  </dd>
                                </>
                              )}
                              {order.tableNumber && (
                                <>
                                  <dt>Table</dt>
                                  <dd>{order.tableNumber}</dd>
                                </>
                              )}
                              <dt>Taken</dt>
                              <dd>
                                {order.channel === 'ONLINE'
                                  ? 'Online'
                                  : order.channel === 'PHONE'
                                    ? 'By phone'
                                    : 'At the counter'}
                                {order.claimedBy ? ` · ${order.claimedBy}` : ''}
                              </dd>
                              {order.syncedAt && (
                                <>
                                  <dt>Offline</dt>
                                  <dd>
                                    Slip {order.offlineRef ?? '—'}, sent to the
                                    office at {formatClock(order.syncedAt)}
                                  </dd>
                                </>
                              )}
                            </dl>

                            {isUnpaid(order) && (
                              <div className="detail-pay">
                                <b>Money collected?</b>
                                <div>
                                  {METHODS.map((method) => (
                                    <button
                                      key={method}
                                      type="button"
                                      className="btn btn-ghost"
                                      disabled={!online || payingId === order.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void collect(order, method);
                                      }}
                                    >
                                      <LuBanknote aria-hidden="true" />
                                      Paid by {method.toLowerCase()}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted ledger-foot">
        {shown.length} {shown.length === 1 ? 'order' : 'orders'} shown
        {shown.length > 0 && ` · ${formatMoney(total)} excluding cancelled`}
        {orders.length >= 200 && ' · the day has more than 200 orders, only the latest are listed'}
      </p>
    </>
  );
}
