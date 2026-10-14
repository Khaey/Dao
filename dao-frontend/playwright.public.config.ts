import { defineConfig, devices } from '@playwright/test';

// Contrôle isolé de la page d’accueil publique : aucun compte, aucun Supabase.
// Volontairement séparé de playwright.config.ts pour ne pas modifier le décompte
// exigé par la CI complète (étape « expected 64 Playwright tests »).
export default defineConfig({
  testDir: './tests/public', timeout: 60_000,
  workers: process.env.CI ? 2 : undefined,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND || 'npm run start', url: 'http://127.0.0.1:3000', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
});
