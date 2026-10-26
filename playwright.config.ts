import { defineConfig } from '@playwright/test';

// E2E_GPU=1 renders on the machine's GPU (enables the frame-rate assertions); otherwise SwiftShader.
const gpu = process.env.E2E_GPU === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: gpu
        ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // tests run against the production bundle, not the dev server
    command: 'npm run data && npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
