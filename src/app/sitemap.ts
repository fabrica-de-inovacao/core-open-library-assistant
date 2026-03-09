import type { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://core.scbc.com.br';

/**
 * Gera /sitemap.xml automaticamente via Next.js App Router.
 * Apenas rotas públicas — workspace é app autenticada, não indexada.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
