export {};

declare global {
  interface TelegramWebApp {
    ready?: () => void;
    expand?: () => void;
    close?: () => void;
    setHeaderColor?: (color: string) => void;
    setBackgroundColor?: (color: string) => void;
  }

  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}
