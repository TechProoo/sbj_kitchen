import { useSyncExternalStore } from 'react';

/// How many requests are in flight right now. Background refreshes are marked
/// quiet and not counted, so a page that polls does not blink at its owner.
let busy = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export async function tracked<T>(work: () => Promise<T>, quiet = false): Promise<T> {
  if (!quiet) {
    busy += 1;
    emit();
  }
  try {
    return await work();
  } finally {
    if (!quiet) {
      busy -= 1;
      emit();
    }
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useBusy = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => busy > 0,
    () => false,
  );
