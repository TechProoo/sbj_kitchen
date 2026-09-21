import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SoldOutItem } from '../lib/types';

/// Items the kitchen switched off mid-service. Putting them back is the first
/// thing anyone does at the start of the next one.
export function SoldOutSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SoldOutItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .soldOut()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, []);

  const restore = async (item: SoldOutItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      await api.setItemAvailability(item.id, true);
      setItems((current) =>
        (current ?? []).filter((entry) => entry.id !== item.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore it.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>Sold out</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          {error && <div className="alert">{error}</div>}

          {items === null && <p>Loading…</p>}

          {items?.length === 0 && (
            <p style={{ color: 'var(--ink-muted)' }}>
              Everything on the menu is available.
            </p>
          )}

          {items?.map((item) => (
            <div key={item.id} className="sold-out-row">
              <b>{item.name}</b>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyId === item.id}
                onClick={() => restore(item)}
              >
                {busyId === item.id ? 'Restoring…' : 'Put back'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
