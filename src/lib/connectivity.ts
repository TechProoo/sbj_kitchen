import { useSyncExternalStore } from 'react';
import { API_URL } from './config';

/*
 * Whether the API can actually be reached.
 *
 * navigator.onLine only says there is a network interface: a kitchen on wifi
 * with a dead uplink still reads "online". So this is driven by what really
 * happens — a request that fails to connect flips it off, any response flips
 * it on — with the browser events as a hint, and a probe that runs while we
 * are down so recovery is noticed without anyone pressing anything.
 */

const PROBE_EVERY_MS = 4000;
const PROBE_TIMEOUT_MS = 5000;

let reachable = typeof navigator === 'undefined' ? true : navigator.onLine;
const listeners = new Set<() => void>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

async function probe(): Promise<void> {
  probeTimer = null;
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Any HTTP answer, even an error, proves the server is reachable.
    await fetch(`${API_URL}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    setReachable(true);
  } catch {
    if (!reachable) scheduleProbe();
  } finally {
    clearTimeout(abort);
  }
}

function scheduleProbe(delay = PROBE_EVERY_MS) {
  if (probeTimer) return;
  probeTimer = setTimeout(() => void probe(), delay);
}

export function setReachable(next: boolean): void {
  if (next === reachable) return;
  reachable = next;
  if (next) {
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = null;
  } else {
    scheduleProbe();
  }
  emit();
}

export const isOnline = (): boolean => reachable;

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setReachable(false));
  // The browser saying "online" is a hint, not proof: check before believing.
  window.addEventListener('online', () => void probe());
  if (!reachable) scheduleProbe(0);
}
