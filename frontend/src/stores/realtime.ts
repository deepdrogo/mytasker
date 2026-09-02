/**
 * WebSocket connection with exponential-backoff reconnect.
 * Incoming events invalidate the affected query namespaces and update stores; the SPA never
 * trusts the socket for authorization - it only reacts to change notifications.
 */

import { createSignal } from 'solid-js';
import { invalidate } from '~/hooks/createQuery';
import { loadTimerState } from '~/stores/timer';
import { pushNotification } from '~/stores/notifications';
import type { AppNotification } from '~/types';

export type ConnectionState = 'connecting' | 'open' | 'offline';

const [state, setState] = createSignal<ConnectionState>('offline');

export const realtimeStore = { state };

let socket: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: number | undefined;
let heartbeat: number | undefined;
let manuallyClosed = false;

type ServerMessage =
  | { type: 'connected'; user_id: number; projects: number[] }
  | { type: 'pong'; t?: number }
  | { type: 'resynced'; projects: number[] }
  | { type: 'notification.new'; notification: AppNotification; unread: number }
  | {
      type: 'event';
      id: number;
      name: string;
      target_type: string;
      target_id: number;
      project_id: number | null;
      actor: string;
      payload: Record<string, unknown>;
    };

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/app/`;
}

/** Map a domain event name to the query namespaces it can affect. */
function scopesFor(name: string): string[] {
  const [domain] = name.split('.');
  switch (domain) {
    case 'task':
    case 'subtask':
      return ['tasks', 'today', 'projects', 'analytics', 'search'];
    case 'comment':
      return ['comments', 'tasks'];
    case 'project':
    case 'idea':
      return ['projects', 'ideas', 'today'];
    case 'prompt':
      return ['prompts', 'projects'];
    case 'share':
      return ['shares', 'tasks'];
    case 'timer':
    case 'sleep':
      return ['timer', 'today', 'analytics', 'tasks', 'routines'];
    case 'ai':
      return ['ai'];
    default:
      return [];
  }
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case 'notification.new':
      pushNotification(message.notification, message.unread);
      invalidate('notifications');
      break;
    case 'event':
      invalidate('activity', ...scopesFor(message.name));
      if (message.name.startsWith('timer.') || message.name.startsWith('sleep.')) void loadTimerState();
      if (message.name === 'project.member_joined' || message.name === 'project.member_removed') resyncRealtime();
      break;
    default:
      break;
  }
}

export function connectRealtime(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  manuallyClosed = false;
  setState('connecting');

  try {
    socket = new WebSocket(socketUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    attempt = 0;
    setState('open');
    heartbeat = window.setInterval(() => {
      socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }, 25_000);
  };

  socket.onmessage = (event) => {
    try {
      handle(JSON.parse(event.data as string) as ServerMessage);
    } catch {
      /* ignore malformed frames */
    }
  };

  socket.onclose = () => {
    cleanupSocket();
    if (!manuallyClosed) scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function cleanupSocket(): void {
  if (heartbeat !== undefined) {
    window.clearInterval(heartbeat);
    heartbeat = undefined;
  }
  socket = null;
  setState('offline');
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return;
  attempt += 1;
  const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 5)) + Math.random() * 400;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectRealtime();
  }, delay);
}

export function disconnectRealtime(): void {
  manuallyClosed = true;
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  socket?.close();
  cleanupSocket();
}

/** Re-join project groups, e.g. after joining or leaving a project. */
export function resyncRealtime(): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync' }));
}
