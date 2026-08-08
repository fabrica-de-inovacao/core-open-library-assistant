import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Gera servidor standalone — necessário para deploy Docker sem yarn/node_modules completo
  output: 'standalone',

  // Remove header "X-Powered-By: Next.js" — reduz exposição de stack
  poweredByHeader: false,

  // React Compiler — memoização automática (requer babel-plugin-react-compiler)
  reactCompiler: true,

  // PPR — movido para top-level no Next.js 16
  cacheComponents: true,

  experimental: {
    // Tree-shaking automático de imports pesados
    optimizePackageImports: ['lucide-react', '@ai-sdk/react', 'iconsax-react', 'sonner'],
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '**.githubusercontent.com' },
    ],
  },

  // Security headers via next.config (complementar ao vercel.json)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },

  // Permite requests cross-origin de tunnels apenas em desenvolvimento local
  ...(isDev && {
    allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io'],
  }),
};

export default nextConfig;
