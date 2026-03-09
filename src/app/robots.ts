import type { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://core.scbc.com.br';

/**
 * Gera /robots.txt dinamicamente via Next.js App Router.
 * Bloqueia indexação do workspace (área autenticada) e APIs internas.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/workspace/', '/api/', '/share/'],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
