import { test, expect, Browser, BrowserType, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const firefoxPrefs = {
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
    await page.click('#videoControlsButton');
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

    // Out-of-range and invalid stored values are clamped or dropped; URL options are ignored
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
