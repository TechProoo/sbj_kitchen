import { useEffect, useState } from 'react';
import { useBusy } from '../lib/activity';

/// Three dots that bounce in turn.
export function BouncingDots({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="dots" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}

/// Floats at the bottom of every owner page while anything is being fetched or
/// saved: a click, an Enter, a refresh. It shows at once and stays a moment after
/// the answer, so even a fast click is seen to have registered.
export function ActivityLoader() {
  const busy = useBusy();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (busy) {
      const timer = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setShown(false), 350);
    return () => clearTimeout(timer);
  }, [busy]);

  if (!shown) return null;

  return (
    <div className="activity" aria-live="polite">
      <BouncingDots label="Working" />
      <span>Working…</span>
    </div>
  );
}
