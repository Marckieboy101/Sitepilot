import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default: most of what's worth testing here is the audit engine
    // and scoring, which are pure functions. Component tests opt into jsdom
    // with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/app/**/layout.tsx', 'src/components/ui/**'],
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
