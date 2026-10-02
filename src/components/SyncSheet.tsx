import { LuCircleAlert, LuClock } from 'react-icons/lu';
import { useOnline } from '../lib/connectivity';
import { formatClock, formatMoney } from '../lib/format';
import {
  discardOp,
  drainOutbox,
  retryOp,
  useOutbox,
  type OutboxOp,
} from '../lib/outbox';

function describe(op: OutboxOp): string {
  switch (op.kind) {
    case 'create':
      return `${op.ticket.orderNumber} · ${op.ticket.items
        .map((item) => `${item.quantity}× ${item.nameSnapshot}`)
        .join(', ')}`;
    case 'status':
      return `Moved a ticket to ${op.status.toLowerCase()}`;
    case 'item':
      return `Ticked an item ${op.status === 'READY' ? 'done' : 'not done'}`;
    case 'cancel':
      return `Cancelled a ticket (${op.reason})`;
  }
}

/// What is saved on this device and has not reached the office yet. Mostly a
/// reassurance, and the place to deal with an order the server turned down.
export function SyncSheet({ onClose }: { onClose: () => void }) {
  const outbox = useOutbox();
  const online = useOnline();

  const orders = outbox.ops.filter((op) => op.kind === 'create');
  const changes = outbox.ops.length - orders.length;

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet sheet-sync" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>Waiting to be sent</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          {outbox.ops.length === 0 && (
            <p className="muted">Everything has been sent. Nothing is waiting.</p>
          )}

          {orders.length > 0 && (
            <ul className="sync-list">
              {orders.map((op) => (
                <li key={op.id} className={op.failed ? 'is-refused' : ''}>
                  <div className="sync-main">
                    <b>{describe(op)}</b>
                    <span>
                      {formatClock(op.at)}
                      {op.kind === 'create' && ` · ${formatMoney(op.ticket.total)}`}
                    </span>
                    {op.kind === 'create' && op.failed && (
                      <em>
                        <LuCircleAlert aria-hidden="true" /> Refused: {op.failed}
                      </em>
                    )}
                    {op.kind === 'create' && !op.failed && (
                      <em className="sync-wait">
                        <LuClock aria-hidden="true" />{' '}
                        {online ? 'Sending…' : 'Waiting for the internet'}
                      </em>
                    )}
                  </div>

                  {op.kind === 'create' && op.failed && (
                    <div className="sync-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => retryOp(op.id)}
                      >
                        Try again
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Throw away ${op.ticket.orderNumber}? The office will never see this order.`,
                            )
                          ) {
                            discardOp(op.id);
                          }
                        }}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {changes > 0 && (
            <p className="muted">
              Plus {changes} {changes === 1 ? 'change' : 'changes'} to tickets
              already on the board (accepting, cooking, handing over).
            </p>
          )}

          {online && outbox.ops.length > 0 && !outbox.syncing && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void drainOutbox()}
            >
              Send now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
