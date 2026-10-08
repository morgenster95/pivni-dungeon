import { defineConfig } from '@playwright/test';

// Testy běží proti demo sestavení (simulované Firebase), takže nepotřebují síť ani produkční data.
// PD_CHROMIUM / PD_CHROMIUM_ARGS umožní použít jiný Chromium (např. v prostředí bez stažených prohlížečů).
const launchOptions = process.env.PD_CHROMIUM
  ? { executablePath: process.env.PD_CHROMIUM, args: JSON.parse(process.env.PD_CHROMIUM_ARGS || '[]') }
  : {};

export default defineConfig({
  testDir: 'tests/layout',
  workers: 1,
  // V CI vypisuje chyby jako anotace u commitu/PR
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173', launchOptions },
  webServer: {
    command: 'npm run build:demo && npx vite preview --outDir dist-demo --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
