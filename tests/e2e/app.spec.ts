import { test, expect, Browser, BrowserType, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'];
const firefoxPrefs = {
    'media.volume_scale': '0.0',
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
    'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false,
};

const browsers: Browser[] = [];

async function launch(type: BrowserType): Promise<Browser> {
    const browser = type.name() === 'firefox'
        ? await type.launch({ firefoxUserPrefs: firefoxPrefs })
        : await type.launch({ args: chromiumArgs });
    browsers.push(browser);
    return browser;
}

async function join(type: BrowserType, room: string): Promise<Page> {
    const page = await (await launch(type)).newPage();
    await page.goto('/' + room);
    return page;
}

function remotes(page: Page) {
    return page.evaluate(() => [...document.querySelectorAll<HTMLDivElement>('#remoteVideo .remoteVideo')].map(div => {
        const video = div.querySelector('video')!;
        const stream = video.srcObject as MediaStream | null;
        return {
            audio: stream?.getAudioTracks().some(t => t.readyState === 'live') ?? false,
            video: !div.classList.contains('noVideo') && video.videoWidth > 0,
        };
    }));
}

async function expectRemotes(page: Page, expected: { audio: number; video: number }) {
    await expect.poll(async () => {
        const r = await remotes(page);
        return { audio: r.filter(x => x.audio).length, video: r.filter(x => x.video).length };
    }).toEqual(expected);
}

async function setVideo(page: Page, on: boolean) {
    if (!await page.locator('#videoControls').isVisible()) {
        await page.click('#videoControlsButton');
    }
    await page.locator('#settingcheckboxVideoEnabled').setChecked(on);
}

test.afterEach(async () => {
    await Promise.all(browsers.splice(0).map(b => b.close()));
});

test('three people join and hear each other', async ({ playwright }) => {
    const room = randomUUID();
    const pages = [await join(playwright.chromium, room), await join(playwright.chromium, room), await join(playwright.chromium, room)];
    for (const page of pages) {
        await expectRemotes(page, { audio: 2, video: 0 });
    }
});

test('turning a camera on and off', async ({ playwright }) => {
    const room = randomUUID();
    const [a, b, c] = [await join(playwright.chromium, room), await join(playwright.chromium, room), await join(playwright.chromium, room)];
    await expectRemotes(b, { audio: 2, video: 0 });
    await setVideo(a, true);
    await expectRemotes(b, { audio: 2, video: 1 });
    await expectRemotes(c, { audio: 2, video: 1 });
    await setVideo(a, false);
    await expectRemotes(b, { audio: 2, video: 0 });
    await expectRemotes(c, { audio: 2, video: 0 });
});

test('someone reloads the page', async ({ playwright }) => {
    const room = randomUUID();
    const [a, b, c] = [await join(playwright.chromium, room), await join(playwright.chromium, room), await join(playwright.chromium, room)];
    await expectRemotes(a, { audio: 2, video: 0 });
    await setVideo(b, true);
    await expectRemotes(a, { audio: 2, video: 1 });
    await b.reload();
    await expectRemotes(a, { audio: 2, video: 0 });
    await expectRemotes(c, { audio: 2, video: 0 });
    await expectRemotes(b, { audio: 2, video: 0 });
    await setVideo(b, true);
    await expectRemotes(a, { audio: 2, video: 1 });
    await expectRemotes(c, { audio: 2, video: 1 });
});

test('someone closes their browser', async ({ playwright }) => {
    const room = randomUUID();
    const [a, b, c] = [await join(playwright.chromium, room), await join(playwright.chromium, room), await join(playwright.chromium, room)];
    await expectRemotes(a, { audio: 2, video: 0 });
    await c.context().browser()!.close();
    await expectRemotes(a, { audio: 1, video: 0 });
    await expectRemotes(b, { audio: 1, video: 0 });
});

test('chromium and firefox in the same room', async ({ playwright }) => {
    const room = randomUUID();
    const [a, b] = [await join(playwright.chromium, room), await join(playwright.firefox, room)];
    await expectRemotes(a, { audio: 1, video: 0 });
    await expectRemotes(b, { audio: 1, video: 0 });
    await setVideo(a, true);
    await setVideo(b, true);
    await expectRemotes(a, { audio: 1, video: 1 });
    await expectRemotes(b, { audio: 1, video: 1 });
});

test('settings are saved and restored, but camera and URL options are not', async ({ playwright }) => {
    const room = randomUUID();
    const page = await join(playwright.chromium, room);
    await page.click('#audioControlsButton');
    await page.locator('#settingcheckboxAudioStereo').setChecked(true);
    await page.locator('#settingrangeAudioGain').fill('3');
    await setVideo(page, true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ae.directchat.settings')))
        .toBe(JSON.stringify({ AudioStereo: true, AudioGain: 3 }));

    await page.evaluate(() => localStorage.setItem('ae.directchat.settings',
        JSON.stringify({ AudioStereo: true, AudioGain: 999, VideoResolution: '<b>x</b>', VideoEnabled: true })));
    await page.goto('/' + room + '?VideoEnabled=true&AudioGain=2');
    await expect(page.locator('#settingcheckboxAudioStereo')).toBeChecked();
    await expect(page.locator('#settingrangeAudioGain')).toHaveValue('5');
    await expect(page.locator('#settingcheckboxVideoEnabled')).not.toBeChecked();
    await expect(page.locator('#settingselect-oneVideoResolution')).toHaveValue('720p');

    await page.click('#audioControlsButton');
    await page.click('#resetSettingsButton');
    await expect(page.locator('#settingcheckboxAudioStereo')).not.toBeChecked();
    await expect(page.locator('#settingrangeAudioGain')).toHaveValue('1');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ae.directchat.settings'))).toBeNull();
});

test('windows keep their header in view, can be dragged on desktop and remember where they were', async ({ playwright }) => {
    const page = await join(playwright.chromium, randomUUID());
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.click('#audioControlsButton');
    await page.click('#attendeeWindowButton');
    await expect(page.locator('#audioControls')).toBeVisible();
    await expect(page.locator('#attendeeWindow')).toBeVisible();

    const close = page.locator('#audioControls .closeButton');
    const before = await close.boundingBox();
    await page.locator('#audioControls .windowBody').evaluate(body => body.scrollTop = body.scrollHeight);
    expect(await close.boundingBox()).toEqual(before);

    const header = await page.locator('#audioControls h1').boundingBox();
    await page.mouse.move(header!.x + 5, header!.y + 5);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 5 });
    await page.mouse.up();
    const moved = await page.locator('#audioControls').boundingBox();
    expect(Math.abs(moved!.y - 200)).toBeLessThan(40);
    expect(moved!.x).toBeLessThan(320);

    await page.reload();
    await page.click('#audioControlsButton');
    expect(await page.locator('#audioControls').boundingBox()).toEqual(moved);

    await page.keyboard.press('Escape');
    await expect(page.locator('#audioControls')).toBeHidden();
});

test('only one window is open at a time on a phone', async ({ playwright }) => {
    const browser = await launch(playwright.chromium);
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto('/' + randomUUID());
    await page.click('#audioControlsButton');
    await page.click('#attendeeWindowButton');
    await expect(page.locator('#audioControls')).toBeHidden();
    await expect(page.locator('#attendeeWindow')).toBeVisible();
    await page.click('#attendeeWindowButton');
    await expect(page.locator('#attendeeWindow')).toBeHidden();
});

test('screen sharing starts inside the user gesture, as Safari requires', async ({ playwright }) => {
    const page = await (await launch(playwright.chromium)).newPage();
    await page.addInitScript(() => {
        let inGesture = false;
        window.addEventListener('change', () => inGesture = true, true);
        window.addEventListener('change', () => inGesture = false);
        navigator.mediaDevices.getDisplayMedia = () => {
            if (!inGesture) {
                return Promise.reject(new DOMException('getDisplayMedia must be called from a user gesture handler.', 'InvalidAccessError'));
            }
            const canvas = document.createElement('canvas');
            canvas.getContext('2d')!.fillRect(0, 0, 10, 10);
            return Promise.resolve(canvas.captureStream(5));
        };
    });
    await page.goto('/' + randomUUID());
    await page.click('#screenControlsButton');
    await page.locator('#settingcheckboxScreenEnabled').setChecked(true);
    await expect.poll(() => page.evaluate(() =>
        ((document.querySelector('#localVideo') as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks().length ?? 0)).toBe(1);
    await expect(page.locator('#settingcheckboxScreenEnabled')).toBeChecked();
    await expect(page.locator('.messages')).not.toContainText('user gesture');
});
