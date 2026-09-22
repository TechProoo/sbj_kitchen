import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney } from '../lib/format';
import type { Ticket } from '../lib/types';

/*
 * The paper ticket.
 *
 * A customer who pays at the counter carries this to the kitchen, so the
 * order number is the biggest thing on it — that number is what the chef
 * matches against the board before serving.
 *
 * It renders into a portal on <body> and the print stylesheet hides
 * everything else, so the dark board never reaches the paper.
 */

function heading(ticket: Ticket): string {
  if (ticket.type === 'DINE_IN') {
    return ticket.tableNumber ? `DINE IN · TABLE ${ticket.tableNumber}` : 'DINE IN';
  }
  return ticket.type === 'PICKUP' ? 'PICK UP' : 'DELIVERY';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PrintTicket({
  ticket,
  onDone,
}: {
  ticket: Ticket;
  onDone: () => void;
}) {
  useEffect(() => {
    const finish = () => onDone();
    window.addEventListener('afterprint', finish);

    // One frame for the browser to lay the ticket out; printing immediately
    // can capture it half-rendered.
    const timer = setTimeout(() => window.print(), 80);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  const paid = ticket.paymentStatus === 'PAID';
  const collection = ticket.type !== 'DELIVERY';

  return createPortal(
    <div className="print-sheet">
      <div className="print-brand">
        <strong>SBJ FOODS AND DRINKS</strong>
        <span>Indy Hall, UI · 8:00 — 21:30</span>
      </div>

      <div className="print-type">{heading(ticket)}</div>

      <div className="print-number">{ticket.orderNumber}</div>

      {collection ? (
        <p className="print-instruction">
          Show this ticket to the kitchen.
          <br />
          Your order is called by this number.
        </p>
      ) : (
        <p className="print-instruction">
          {ticket.address?.line1}
          {ticket.address?.city ? `, ${ticket.address.city}` : ''}
          {ticket.address?.landmark ? ` (${ticket.address.landmark})` : ''}
          {/* Printed so a rider working off paper still has the pin to type
              into their phone. */}
          {ticket.address?.latitude && ticket.address?.longitude && (
            <>
              <br />
              <span className="print-pin">
                Pin {ticket.address.latitude}, {ticket.address.longitude}
              </span>
            </>
          )}
        </p>
      )}

      <hr />

      <table className="print-lines">
        <tbody>
          {ticket.items.map((item) => (
            <tr key={item.id}>
              <td className="print-qty">{item.quantity}×</td>
              <td>
                {item.nameSnapshot}
                {item.modifiers.length > 0 && (
                  <small>{item.modifiers.map((m) => m.nameSnapshot).join(', ')}</small>
                )}
                {item.notes && <small>Note: {item.notes}</small>}
              </td>
              <td className="print-amount">{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr />

      <table className="print-totals">
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="print-amount">{formatMoney(ticket.subtotal)}</td>
          </tr>
          {Number(ticket.deliveryFee) > 0 && (
            <tr>
              <td>Delivery</td>
              <td className="print-amount">{formatMoney(ticket.deliveryFee)}</td>
            </tr>
          )}
          <tr className="print-grand">
            <td>Total</td>
            <td className="print-amount">{formatMoney(ticket.total)}</td>
          </tr>
        </tbody>
      </table>

      {/* The one line the counter and the chef both read before serving. */}
      <div className={`print-stamp${paid ? '' : ' unpaid'}`}>
        {paid
          ? `PAID${ticket.paymentMethod ? ` · ${ticket.paymentMethod}` : ''}`
          : 'NOT PAID — PAY AT THE COUNTER'}
      </div>

      {ticket.notes && <p className="print-note">Kitchen: {ticket.notes}</p>}

      <p className="print-foot">
        {ticket.customerName}
        {ticket.customerPhone ? ` · ${ticket.customerPhone}` : ''}
        <br />
        {when(ticket.placedAt)}
      </p>
    </div>,
    document.body,
  );
}
