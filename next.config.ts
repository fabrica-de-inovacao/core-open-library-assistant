import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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

  // Permite requests cross-origin do ngrok em dev
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io'],
};

export default nextConfig;
