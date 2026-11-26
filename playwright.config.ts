import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: true,
    reporter: [['list']],
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                launchOptions: {
                    args: [
                        '--autoplay-policy=no-user-gesture-required',
                        '--use-fake-ui-for-media-stream',
                        '--use-fake-device-for-media-stream',
                        '--disable-features=WebRtcHideLocalIpsWithMdns',
                    ],
                },
            },
        },
        {
            name: 'firefox',
            use: {
                browserName: 'firefox',
                launchOptions: {
                    firefoxUserPrefs: {
                        'media.autoplay.default': 0,
                        'media.autoplay.block-webaudio': false,
                        'media.navigator.streams.fake': true,
                        'media.navigator.permission.disabled': true,
                        'media.peerconnection.ice.obfuscate_host_addresses': false,
                    },
                },
            },
        },
    ],
});
