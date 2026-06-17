// Sự kiện nội bộ để thông báo qua Telegram. Các service phát sự kiện,
// TelegramService lắng nghe — tránh phụ thuộc vòng giữa các module.
export const NotifyEvents = {
  UserCreated: 'notify.user.created',
  SiteCreated: 'notify.site.created',
  DepositIntent: 'notify.deposit.intent',
} as const;

export interface UserCreatedPayload {
  username: string;
  email: string;
  source: 'password' | 'google';
}

export interface SiteCreatedPayload {
  username: string;
  siteName: string;
  baseUrl: string;
}

export interface DepositIntentPayload {
  username: string;
  amount: number;
}
