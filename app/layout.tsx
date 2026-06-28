import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'Aligator Rent CRM',
  description: 'Bike-centered rent CRM Telegram Mini App',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}