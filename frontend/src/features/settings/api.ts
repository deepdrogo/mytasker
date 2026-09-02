import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import { applyMe } from '~/stores/auth';
import type { Me, NotificationPreferences, TelegramStatus, UserPreferences } from '~/types';

export interface TelegramLinkStart {
  token: string;
  expires_at: string;
  deep_link: string;
  bot_username: string;
}

export interface TelegramDeliveryRow {
  id: number;
  kind: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  last_error: string;
  attempts: number;
}

export const settingsApi = {
  updateProfile: async (input: { full_name?: string; timezone?: string; locale?: string }) => {
    const me = await api.patch<Me>('/auth/me/', input);
    applyMe(me);
    return me;
  },
  updatePreferences: async (input: Partial<UserPreferences>) => {
    const me = await api.patch<Me>('/auth/me/preferences/', input);
    applyMe(me);
    invalidate('today', 'analytics');
    return me;
  },
  updateNotificationPreferences: async (input: Partial<NotificationPreferences>) => {
    const me = await api.patch<Me>('/auth/me/notifications/', input);
    applyMe(me);
    return me;
  },
  changePassword: (current_password: string, new_password: string) => api.post('/auth/password/change/', { current_password, new_password }),
  resendVerification: () => api.post('/auth/email/resend/'),
};

export const telegramApi = {
  status: () => api.get<TelegramStatus>('/telegram/'),
  startLink: () => api.post<TelegramLinkStart>('/telegram/link/'),
  unlink: async () => {
    const status = await api.post<TelegramStatus>('/telegram/unlink/');
    invalidate('telegram');
    return status;
  },
  test: () => api.post<{ queued: boolean }>('/telegram/test/'),
  deliveries: () => api.get<TelegramDeliveryRow[]>('/telegram/deliveries/'),
};
