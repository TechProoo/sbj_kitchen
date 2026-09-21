import { useState } from 'react';
import type { Ticket } from '../lib/types';

const REASONS = [
  'Customer changed their mind',
  'Item unavailable',
  'Cannot reach the customer',
  'Duplicate order',
  'Outside delivery area',
];

export function CancelSheet({
  ticket,
  onClose,
  onConfirm,
}: {
  ticket: Ticket;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [custom, setCustom] = useState('');

  const finalReason = reason === 'Other' ? custom.trim() : reason;

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>Cancel {ticket.orderNumber}?</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep it
          </button>
        </div>

        <div className="sheet-body">
          <div className="alert">
            This cannot be undone. {ticket.customerName} will see the order as
            cancelled.
          </div>

          <div className="field">
            <label htmlFor="reason">Reason</label>
            <select
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              {REASONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
              <option value="Other">Other…</option>
            </select>
          </div>

          {reason === 'Other' && (
            <div className="field">
              <label htmlFor="custom-reason">Tell us what happened</label>
              <input
                id="custom-reason"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                maxLength={300}
                autoFocus
              />
            </div>
          )}

          <button
            type="button"
            className="btn btn-danger"
            disabled={!finalReason}
            onClick={() => onConfirm(finalReason)}
          >
            Cancel this order
          </button>
        </div>
      </div>
    </div>
  );
}
