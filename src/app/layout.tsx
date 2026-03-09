import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// ---------------------------------------------------------------------------
// Metadados raiz — herdados por todas as rotas (exceto overrides por rota)
// ---------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://core.scbc.com.br';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default: 'C.O.R.E. AI — Pesquisa Acadêmica com Inteligência Artificial',
    template: '%s | C.O.R.E. AI',
  },

  description:
    'Plataforma de revisão sistemática automatizada com IA. Busque, analise e sintetize artigos científicos das principais bases acadêmicas em minutos.',

  keywords: [
    'revisão sistemática',
    'pesquisa acadêmica',
    'inteligência artificial',
    'IA para pesquisa',
    'SCBC',
    'C.O.R.E.',
    'literatura científica',
    'artigos acadêmicos',
  ],

  authors: [{ name: 'SCBC', url: 'https://scbc.com.br' }],

  creator: 'SCBC',

  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: APP_URL,
    siteName: 'C.O.R.E. AI',
    title: 'C.O.R.E. AI — Pesquisa Acadêmica com Inteligência Artificial',
    description:
      'Plataforma de revisão sistemática automatizada com IA. Busque, analise e sintetize artigos científicos das principais bases acadêmicas em minutos.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'C.O.R.E. AI — Pesquisa acadêmica com inteligência artificial',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'C.O.R.E. AI — Pesquisa Acadêmica com Inteligência Artificial',
    description:
      'Plataforma de revisão sistemática automatizada com IA. Busque, analise e sintetize artigos científicos.',
    images: ['/og-image.png'],
    creator: '@scbc_br',
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },

  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Script anti-FOUC: aplica tema antes do primeiro render */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sol-theme');if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <Suspense>{children}</Suspense>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
