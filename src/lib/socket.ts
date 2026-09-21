import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { getAccessToken } from './supabase';

const REALTIME_URL = `${API_URL.replace(/\/api\/?$/, '')}/realtime`;

let socket: Socket | null = null;

/// The gateway reads the token from the handshake and joins this screen to the
/// kitchen room, so no explicit subscribe call is needed.
export async function connectKitchenSocket(): Promise<Socket> {
  const token = await getAccessToken();

  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }

  socket = io(REALTIME_URL, {
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  return socket;
}

export function disconnectKitchenSocket(): void {
  socket?.disconnect();
  socket = null;
}
