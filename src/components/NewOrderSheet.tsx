import { useEffect, useMemo, useState } from 'react';
import {
  LuBanknote,
  LuCheck,
  LuCreditCard,
  LuMinus,
  LuPlus,
  LuPrinter,
  LuSearch,
  LuSmartphone,
  LuTrash2,
  LuX,
} from 'react-icons/lu';
import { PrintTicket } from './PrintTicket';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type {
  CounterOrderInput,
  MenuCategory,
  MenuItem,
  Modifier,
  OrderType,
  Ticket,
} from '../lib/types';

/// Must match DELIVERY_FEE in the API env, as the storefront's checkout does.
/// The server recalculates the real figure; this only previews it, and the
/// total on the created ticket is the one that counts.
const DELIVERY_FEE = 1500;

const TYPES: { value: OrderType; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine in' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'DELIVERY', label: 'Delivery' },
];

const METHODS: { value: 'CASH' | 'CARD' | 'TRANSFER'; label: string; icon: typeof LuBanknote }[] = [
  { value: 'CASH', label: 'Cash', icon: LuBanknote },
  { value: 'CARD', label: 'Card', icon: LuCreditCard },
  { value: 'TRANSFER', label: 'Transfer', icon: LuSmartphone },
];

/// One line on the ticket being built. Modifiers are held as whole objects so
/// the running total can be shown without a round trip.
interface Line {
  key: string;
  item: MenuItem;
  quantity: number;
  modifiers: Modifier[];
  notes?: string;
}

const lineKey = (itemId: string, modifierIds: string[]) =>
  [itemId, [...modifierIds].sort().join('+')].join('|');

const priceOf = (line: Line) =>
  (Number(line.item.price) +
    line.modifiers.reduce((sum, m) => sum + Number(m.priceDelta), 0)) *
  line.quantity;

/*
 * Taking an order at the counter.
 *
 * The left half is the menu, the right half is the ticket. Everything the
 * customer would have typed into the storefront is optional here — the point
 * is to get a cash sale onto the board in under a minute.
 */
export function NewOrderSheet({
  onClose,
  onPlaced,
}: {
  onClose: () => void;
  onPlaced: (ticket: Ticket) => void;
}) {
  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [type, setType] = useState<OrderType>('PICKUP');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [paid, setPaid] = useState(true);

  /// The item whose options are being chosen, if any.
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /// Set once the ticket exists. The sheet then shows the printing step
  /// rather than closing, because the customer is still standing there.
  const [placed, setPlaced] = useState<Ticket | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api
      .menu()
      .then((categories) => {
        setMenu(categories);
        setActiveCategory(categories[0]?.id ?? null);
      })
      .catch((err: unknown) =>
        setMenuError(
          err instanceof ApiError ? err.message : 'Could not load the menu.',
        ),
      );
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (choosing) setChoosing(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [choosing, onClose]);

  const visible = useMemo(() => {
    if (!menu) return [];
    const term = search.trim().toLowerCase();
    if (term) {
      return menu
        .map((category) => ({
          ...category,
          items: category.items.filter((item) =>
            item.name.toLowerCase().includes(term),
          ),
        }))
        .filter((category) => category.items.length > 0);
    }
    return menu.filter((category) => category.id === activeCategory);
  }, [menu, search, activeCategory]);

  const subtotal = lines.reduce((sum, line) => sum + priceOf(line), 0);
  const deliveryFee = type === 'DELIVERY' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;

  /* --------------------------------------------------------- ticket edits */

  const addLine = (item: MenuItem, modifiers: Modifier[]) => {
    const key = lineKey(
      item.id,
      modifiers.map((m) => m.id),
    );
    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(50, line.quantity + 1) }
            : line,
        );
      }
      return [...current, { key, item, quantity: 1, modifiers }];
    });
  };

  /// An item with choices opens the options panel; everything else goes
  /// straight onto the ticket, which is most of the menu.
  const pick = (item: MenuItem) => {
    if (!item.isAvailable) return;
    if (item.modifierGroups.length === 0) {
      addLine(item, []);
      return;
    }
    setChoosing(item);
    setChosen(
      Object.fromEntries(
        item.modifierGroups.map((group) => [
          group.id,
          group.minSelect > 0 && group.modifiers[0] ? [group.modifiers[0].id] : [],
        ]),
      ),
    );
  };

  const toggleChoice = (groupId: string, modifierId: string, maxSelect: number) => {
    setChosen((current) => {
      const existing = current[groupId] ?? [];
      if (maxSelect === 1) return { ...current, [groupId]: [modifierId] };
      if (existing.includes(modifierId)) {
        return { ...current, [groupId]: existing.filter((id) => id !== modifierId) };
      }
      const next =
        existing.length >= maxSelect
          ? [...existing.slice(1), modifierId]
          : [...existing, modifierId];
      return { ...current, [groupId]: next };
    });
  };

  const confirmChoices = () => {
    if (!choosing) return;
    const modifiers = choosing.modifierGroups.flatMap((group) =>
      group.modifiers.filter((m) => chosen[group.id]?.includes(m.id)),
    );
    addLine(choosing, modifiers);
    setChoosing(null);
  };

  const unmetGroup = choosing?.modifierGroups.find(
    (group) => (chosen[group.id]?.length ?? 0) < group.minSelect,
  );

  const setQuantity = (key: string, quantity: number) =>
    setLines((current) =>
      quantity < 1
        ? current.filter((line) => line.key !== key)
        : current.map((line) =>
            line.key === key ? { ...line, quantity: Math.min(50, quantity) } : line,
          ),
    );

  /* ------------------------------------------------------------- sending */

  const missing =
    lines.length === 0
      ? 'Add something to the ticket'
      : type === 'DELIVERY' && (!addressLine.trim() || !addressCity.trim())
        ? 'A delivery needs a street and a city'
        : null;

  const send = async () => {
    if (missing) return;
    setSubmitting(true);
    setError(null);

    const payload: CounterOrderInput = {
      type,
      channel: 'WALK_IN',
      paymentMethod: method,
      paid,
      items: lines.map((line) => ({
        menuItemId: line.item.id,
        quantity: line.quantity,
        modifierIds: line.modifiers.map((m) => m.id),
      })),
      ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
      ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
      ...(tableNumber.trim() ? { tableNumber: tableNumber.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(type === 'DELIVERY'
        ? { address: { line1: addressLine.trim(), city: addressCity.trim() } }
        : {}),
    };

    try {
      const ticket = await api.createManual(payload);
      onPlaced(ticket);
      setPlaced(ticket);
      setSubmitting(false);
      // Collection orders are handed a ticket immediately — that slip is how
      // the customer reaches the chef. A delivery has nobody to hand it to,
      // so it only prints if someone asks.
      if (ticket.type !== 'DELIVERY') setPrinting(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'That did not go through.',
      );
      setSubmitting(false);
    }
  };

  /// Same cashier, next customer in the queue.
  const startAnother = () => {
    setPlaced(null);
    setPrinting(false);
    setLines([]);
    setCustomerName('');
    setCustomerPhone('');
    setTableNumber('');
    setAddressLine('');
    setAddressCity('');
    setNotes('');
    setPaid(true);
    setSearch('');
    setError(null);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet sheet-order"
        role="dialog"
        aria-modal="true"
        aria-label="Take an order"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <div>
            <h2>Take an order</h2>
            <p>Walk-in or phoned through. It goes on the board accepted.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            <LuX aria-hidden="true" />
            Close
          </button>
        </header>

        {placed ? (
          <div className="order-placed">
            <span className="order-placed-tick">
              <LuCheck aria-hidden="true" />
            </span>

            <p className="order-placed-label">
              On the board, accepted
              {placed.paymentStatus === 'PAID' ? ' and paid' : ' — not yet paid'}
            </p>

            <b className="order-placed-number">{placed.orderNumber}</b>

            <p className="order-placed-total">
              {formatMoney(placed.total)}
              {placed.paymentMethod ? ` · ${placed.paymentMethod}` : ''}
            </p>

            <p className="order-placed-hint">
              {placed.type === 'DELIVERY'
                ? 'Going out for delivery — no ticket printed.'
                : 'Hand the printed ticket to the customer. They take it to the kitchen, and the chef serves them against this number.'}
            </p>

            <div className="order-placed-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPrinting(true)}
              >
                <LuPrinter aria-hidden="true" />
                {placed.type === 'DELIVERY' ? 'Print a copy' : 'Print again'}
              </button>

              <button type="button" className="btn btn-primary" onClick={startAnother}>
                <LuPlus aria-hidden="true" />
                Next customer
              </button>

              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
        <div className="order-split">
          {/* ------------------------------------------------- menu side */}

          <div className="order-menu">
            <div className="order-search">
              <LuSearch aria-hidden="true" />
              <input
                type="search"
                placeholder="Search the menu…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search the menu"
              />
            </div>

            {!search && menu && (
              <div className="order-tabs">
                {menu.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={category.id === activeCategory ? 'is-on' : ''}
                    onClick={() => setActiveCategory(category.id)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            )}

            {menuError && <div className="alert">{menuError}</div>}
            {!menu && !menuError && <p className="muted">Loading the menu…</p>}

            <div className="order-items">
              {visible.map((category) =>
                category.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="order-item"
                    disabled={!item.isAvailable}
                    onClick={() => pick(item)}
                  >
                    <span className="order-item-name">{item.name}</span>
                    <span className="order-item-price">
                      {item.isAvailable ? formatMoney(item.price) : 'Sold out'}
                    </span>
                    {item.modifierGroups.length > 0 && item.isAvailable && (
                      <i>options</i>
                    )}
                  </button>
                )),
              )}
              {menu && visible.length === 0 && (
                <p className="muted">Nothing matches “{search}”.</p>
              )}
            </div>
          </div>

          {/* ----------------------------------------------- ticket side */}

          <div className="order-ticket">
            <div className="order-types">
              {TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={type === option.value ? 'is-on' : ''}
                  onClick={() => setType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="order-lines">
              {lines.length === 0 && (
                <p className="muted">Tap dishes on the left to build the ticket.</p>
              )}

              {lines.map((line) => (
                <div key={line.key} className="order-line">
                  <div className="order-line-main">
                    <b>{line.item.name}</b>
                    {line.modifiers.length > 0 && (
                      <span>{line.modifiers.map((m) => m.name).join(' · ')}</span>
                    )}
                  </div>

                  <div className="order-line-qty">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.key, line.quantity - 1)}
                      aria-label={`One less ${line.item.name}`}
                    >
                      <LuMinus aria-hidden="true" />
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.key, line.quantity + 1)}
                      aria-label={`One more ${line.item.name}`}
                    >
                      <LuPlus aria-hidden="true" />
                    </button>
                  </div>

                  <b className="order-line-total">{formatMoney(priceOf(line))}</b>

                  <button
                    type="button"
                    className="order-line-drop"
                    onClick={() => setQuantity(line.key, 0)}
                    aria-label={`Remove ${line.item.name}`}
                  >
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div className="order-fields">
              {type === 'DINE_IN' && (
                <label>
                  Table
                  <input
                    value={tableNumber}
                    onChange={(event) => setTableNumber(event.target.value)}
                    placeholder="4"
                    maxLength={10}
                  />
                </label>
              )}

              {type === 'DELIVERY' && (
                <>
                  <label>
                    Street
                    <input
                      value={addressLine}
                      onChange={(event) => setAddressLine(event.target.value)}
                      placeholder="12 Allen Avenue"
                    />
                  </label>
                  <label>
                    City
                    <input
                      value={addressCity}
                      onChange={(event) => setAddressCity(event.target.value)}
                      placeholder="Ikeja"
                    />
                  </label>
                </>
              )}

              <label>
                Name <i>optional</i>
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Walk-in"
                  maxLength={80}
                />
              </label>

              <label>
                Phone <i>optional</i>
                <input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="0803…"
                  inputMode="tel"
                />
              </label>

              <label className="order-field-wide">
                Notes for the kitchen <i>optional</i>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="No pepper, pack separately…"
                  maxLength={500}
                />
              </label>
            </div>

            <div className="order-pay">
              <div className="order-methods">
                {METHODS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={method === value ? 'is-on' : ''}
                    onClick={() => setMethod(value)}
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              <label className="order-paid">
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={(event) => setPaid(event.target.checked)}
                />
                Money taken
              </label>
            </div>

            <div className="order-totals">
              <div>
                <span>Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {deliveryFee > 0 && (
                <div>
                  <span>Delivery</span>
                  <span>{formatMoney(deliveryFee)}</span>
                </div>
              )}
              <div className="order-grand">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            <button
              type="button"
              className="btn btn-primary order-send"
              onClick={() => void send()}
              disabled={Boolean(missing) || submitting}
            >
              {submitting
                ? 'Sending…'
                : (missing ?? `Send to kitchen · ${formatMoney(total)}`)}
            </button>
          </div>
        </div>

        )}

        {/* The paper ticket: printed straight away for collection orders. */}
        {placed && printing && (
          <PrintTicket ticket={placed} onDone={() => setPrinting(false)} />
        )}

        {/* ------------------------------------------------- options panel */}

        {choosing && (
          <div className="sheet-backdrop inner" onClick={() => setChoosing(null)}>
            <div
              className="sheet sheet-options"
              role="dialog"
              aria-modal="true"
              aria-label={`Options for ${choosing.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="sheet-head">
                <div>
                  <h2>{choosing.name}</h2>
                  <p>{formatMoney(choosing.price)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setChoosing(null)}
                >
                  <LuX aria-hidden="true" />
                </button>
              </header>

              <div className="option-groups">
                {choosing.modifierGroups.map((group) => (
                  <div key={group.id}>
                    <h3>
                      {group.name}
                      <i>
                        {group.minSelect > 0 ? 'required' : 'optional'} ·{' '}
                        {group.maxSelect === 1
                          ? 'choose one'
                          : `up to ${group.maxSelect}`}
                      </i>
                    </h3>

                    {group.modifiers.map((modifier) => (
                      <label key={modifier.id} className="option-row">
                        <input
                          type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                          name={group.id}
                          checked={chosen[group.id]?.includes(modifier.id) ?? false}
                          disabled={!modifier.isAvailable}
                          onChange={() =>
                            toggleChoice(group.id, modifier.id, group.maxSelect)
                          }
                        />
                        <span>{modifier.name}</span>
                        {Number(modifier.priceDelta) > 0 && (
                          <b>+{formatMoney(modifier.priceDelta)}</b>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmChoices}
                disabled={Boolean(unmetGroup)}
              >
                {unmetGroup
                  ? `Choose ${unmetGroup.name.toLowerCase()}`
                  : 'Add to ticket'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
