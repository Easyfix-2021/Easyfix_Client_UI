/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Hide the floating "N" dev indicator (the small circle that
  // Next.js renders bottom-left while the app is running in dev /
  // turbopack). Doesn't affect prod builds where it never appears.
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
