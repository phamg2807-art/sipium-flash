import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'Sipium Flash — Learn faster. Remember longer.',
  description:
    'AI flashcard creation and English learning for Vietnamese students. Turn any text, word list or image into a deck you actually want to study.',
};

export const viewport: Viewport = {
  themeColor: '#fafbfd',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

const THEME_SCRIPT = `
(function(){try{
  var raw = localStorage.getItem('sipium.settings');
  var theme = raw ? (JSON.parse(raw).theme || 'light') : 'light';
  var resolved = theme === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}catch(e){document.documentElement.dataset.theme='light';}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
