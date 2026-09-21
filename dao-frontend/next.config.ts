import type { NextConfig } from 'next';
import path from 'node:path';
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '..'),
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
export default nextConfig;
