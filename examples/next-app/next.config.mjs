/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK packages are published as ESM + CJS with types; nothing to transpile.
  experimental: {},
};

export default nextConfig;
