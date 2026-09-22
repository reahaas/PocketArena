import { defineConfig, devices } from '@playwright/test';

/**
 * Two modes:
 *   - default: builds the client and serves it from the signaling process, exactly as
 *     production does, on one port.
 *   - E2E_BASE_URL set: runs against an already-running stack, e.g. docker compose.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8787';
const useExternalStack = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Headless Chromium only gives steady animation frames to the foreground page, so multi-page
  // WebRTC tests can lose a handshake race under load. One retry, never a weaker assertion.
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // The host must keep simulating while a second page is in front of it, so every
    // form of background throttling has to be off or the multiplayer tests are meaningless.
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(useExternalStack
    ? {}
    : {
        webServer: [
          {
            command: 'npm run serve',
            port: 8787,
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120_000,
          },
        ],
      }),
});
