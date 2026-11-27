import { defineConfig } from '@playwright/test';

export const port = 5199;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    reporter: [['list']],
    use: { baseURL: `http://localhost:${port}` },
    webServer: {
        command: `dotnet run --no-launch-profile --urls http://localhost:${port}`,
        url: `http://localhost:${port}/healthz`,
        env: { ALLOWED_ORIGINS: `http://localhost:${port}` },
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
    },
});
