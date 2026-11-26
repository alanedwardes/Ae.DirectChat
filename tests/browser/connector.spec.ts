import { test, expect, colours, openLinkedPages } from './fixtures';

const { red, green, blue, yellow, magenta, cyan } = colours;

test.describe('connecting', () => {
    test('exchanges audio and video both ways', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.send('b', { tone: 1000, video: blue });
        await peers.waitConnected('a', 'b');
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.waitReceiving('a', { tone: 1000, video: blue });
        await peers.expectHealthy('a', 'b');
    });

    test('audio-only call', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000 });
        await peers.waitReceiving('b', { tone: 400 });
        await peers.waitReceiving('a', { tone: 1000 });
        await peers.expectHealthy('a', 'b');
    });

    test('one side with video, the other audio only', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000, video: green });
        await peers.waitReceiving('a', { tone: 1000, video: green });
        await peers.waitReceiving('b', { tone: 400 });
        await peers.expectHealthy('a', 'b');
    });

    test('connects over slow, jittery signalling', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.latency('a', 'b', 300, 300);
        await peers.latency('b', 'a', 300, 300);
        await peers.send('a', { tone: 400, video: red });
        await peers.send('b', { tone: 1000, video: blue });
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.waitReceiving('a', { tone: 1000, video: blue });
        await peers.expectHealthy('a', 'b');
    });

    test('the answering side only hears the offer later', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.hold('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.send('b', { tone: 1000 });
        await peers.page.waitForTimeout(2000);
        await peers.release('a', 'b');
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.waitReceiving('a', { tone: 1000 });
        await peers.expectHealthy('a', 'b');
    });

    test('media changed again before the connection is up', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.hold('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.send('a', { tone: 700, video: green });
        await peers.send('b', { tone: 1000 });
        await peers.release('a', 'b');
        await peers.waitReceiving('b', { tone: 700, video: green });
        await peers.expectHealthy('a', 'b');
    });
});

test.describe('changing media mid-call', () => {
    test.beforeEach(async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000 });
        await peers.waitReceiving('b', { tone: 400 });
        await peers.waitReceiving('a', { tone: 1000 });
    });

    test('turning the camera on', async ({ peers }) => {
        await peers.send('a', { tone: 400, video: red });
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.expectHealthy('a', 'b');
    });

    test('turning the camera off', async ({ peers }) => {
        await peers.send('a', { tone: 400, video: red });
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.send('a', { tone: 400 });
        await peers.waitReceiving('b', { tone: 400 });
        await peers.expectHealthy('a', 'b');
    });

    test('the answering side turns its camera on', async ({ peers }) => {
        await peers.send('b', { tone: 1000, video: blue });
        await peers.waitReceiving('a', { tone: 1000, video: blue });
        await peers.expectHealthy('a', 'b');
    });

    test('switching from camera to screen share swaps the picture', async ({ peers }) => {
        await peers.send('a', { tone: 400, video: red });
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.send('a', { tone: 400, video: green });
        await peers.waitReceiving('b', { tone: 400, video: green });
        await peers.expectHealthy('a', 'b');
    });

    test('a new audio track replaces the old one', async ({ peers }) => {
        await peers.send('a', { tone: 700 });
        await peers.waitReceiving('b', { tone: 700 });
        await peers.send('a', { tone: 1500 });
        await peers.waitReceiving('b', { tone: 1500 });
        await peers.expectHealthy('a', 'b');
    });

    test('toggling video on and off repeatedly', async ({ peers }) => {
        for (const video of [red, null, green, null, blue, yellow, null, magenta]) {
            await peers.send('a', { tone: 400, video });
            await peers.waitReceiving('b', { tone: 400, video });
        }
        await peers.expectHealthy('a', 'b');
    });

    test('toggling media does not grow the session', async ({ peers }) => {
        const mediaSections = () => peers.page.evaluate(() =>
            ['a', 'b'].map(n => ((window as any).H.get(n).connector.pc.localDescription.sdp.match(/^m=/gm) ?? []).length));
        await peers.send('a', { tone: 400, video: red });
        await peers.waitReceiving('b', { tone: 400, video: red });
        const before = await mediaSections();
        for (const video of [null, green, null, blue, null, yellow]) {
            await peers.send('a', { tone: 400, video });
            await peers.send('b', { tone: 1000, video });
            await peers.waitReceiving('b', { tone: 400, video });
            await peers.waitReceiving('a', { tone: 1000, video });
        }
        expect(await mediaSections()).toEqual(before);
    });

    test('rapid changes settle on the last one', async ({ peers }) => {
        for (const video of [red, null, green, blue, null, yellow, cyan]) {
            await peers.send('a', { tone: 400, video });
        }
        await peers.waitReceiving('b', { tone: 400, video: cyan });
        await peers.expectHealthy('a', 'b');
    });

    test('both sides change media at the same moment', async ({ peers }) => {
        const rounds: [string | null, string | null][] = [[red, blue], [null, green], [yellow, null], [cyan, magenta]];
        for (const [aVideo, bVideo] of rounds) {
            await Promise.all([peers.send('a', { tone: 400, video: aVideo }), peers.send('b', { tone: 1000, video: bVideo })]);
            await peers.waitReceiving('b', { tone: 400, video: aVideo });
            await peers.waitReceiving('a', { tone: 1000, video: bVideo });
        }
        await peers.expectHealthy('a', 'b');
    });

    test('both sides change media at once over slow signalling', async ({ peers }) => {
        await peers.latency('a', 'b', 200, 200);
        await peers.latency('b', 'a', 200, 200);
        await Promise.all([peers.send('a', { tone: 400, video: red }), peers.send('b', { tone: 1000, video: blue })]);
        await peers.waitReceiving('b', { tone: 400, video: red });
        await peers.waitReceiving('a', { tone: 1000, video: blue });
        await Promise.all([peers.send('a', { tone: 400, video: green }), peers.send('b', { tone: 1000 })]);
        await peers.waitReceiving('b', { tone: 400, video: green });
        await peers.waitReceiving('a', { tone: 1000 });
        await peers.expectHealthy('a', 'b');
    });
});

test.describe('failing and closing', () => {
    test('times out when signals never arrive', async ({ peers }) => {
        await peers.setConnectTimeout(2000);
        await peers.pair('a', 'b');
        await peers.dropAll('b', 'a');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000 });
        await peers.waitClosed('a', 10_000);
        await peers.waitClosed('b', 10_000);
        expect((await peers.snapshot('a')).events.map(e => e.detail)).toContain('connection: timed out');
        await peers.expectHealthy('a', 'b');
    });

    test('times out when there is no network route', async ({ peers }) => {
        await peers.setConnectTimeout(3000);
        await peers.pair('a', 'b');
        await peers.blockRoute('a', 'b');
        await peers.blockRoute('b', 'a');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000 });
        await peers.waitClosed('a', 10_000);
        await peers.waitClosed('b', 10_000);
        await peers.expectHealthy('a', 'b');
    });

    test('closing one side closes the other', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.send('b', { tone: 1000 });
        await peers.waitReceiving('b', { tone: 400, video: red });
        const start = Date.now();
        await peers.destroy('a');
        await peers.waitClosed('b', 40_000);
        console.log(`[${test.info().project.name}] remote close noticed after ${Date.now() - start}ms`);
        await peers.expectHealthy('a', 'b');
    });

    test('destroy before connecting is clean and final', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.destroy('a');
        await peers.destroy('a');
        await peers.send('a', { tone: 700 });
        await peers.signal('a', { type: 'answer', sdp: 'v=0\r\n' });
        const snapshot = await peers.snapshot('a');
        expect(snapshot.closeCount).toBe(1);
        expect(snapshot.isConnected).toBe(false);
        await peers.page.waitForTimeout(1000);
        expect((await peers.snapshot('a')).events.at(-1)!.kind).toBe('close');
        await peers.expectHealthy('a', 'b');
    });

    test('nothing is reported after destroy', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400, video: red });
        await peers.send('b', { tone: 1000, video: blue });
        await peers.waitReceiving('a', { tone: 1000, video: blue });
        await peers.destroy('a');
        const count = (await peers.snapshot('a')).events.length;
        await peers.send('b', { tone: 1000, video: green });
        await peers.page.waitForTimeout(2000);
        expect((await peers.snapshot('a')).events.length).toBe(count);
        await peers.expectHealthy('a', 'b');
    });

    test('garbage signals do not throw out of Signal', async ({ peers }) => {
        await peers.pair('a', 'b');
        await peers.send('a', { tone: 400 });
        await peers.send('b', { tone: 1000 });
        await peers.waitConnected('a', 'b');
        for (const junk of [{}, { type: 'nonsense' }, { type: 'answer' }, { type: 'candidate' }, { candidate: { candidate: 'garbage' } }]) {
            await peers.signal('b', junk);
        }
        await peers.page.waitForTimeout(500);
        expect((await peers.snapshot('b')).errors).toEqual([]);
    });
});

test.describe('several peers', () => {
    test('full mesh of four, each sharing one local stream with everyone', async ({ peers }) => {
        const people = ['p', 'q', 'r', 's'];
        const media: Record<string, { tone: number; video: string }> = {
            p: { tone: 300, video: red }, q: { tone: 600, video: green }, r: { tone: 1000, video: blue }, s: { tone: 1500, video: yellow },
        };
        const links: [string, string][] = [];
        for (const x of people) for (const y of people) if (x < y) links.push([x, y]);
        await peers.page.evaluate(([links, media]) => {
            const H = (window as any).H;
            const streams: Record<string, MediaStream> = {};
            for (const [name, m] of Object.entries(media as Record<string, unknown>)) {
                streams[name] = (window as any).makeLocalStream(m);
            }
            for (const [x, y] of links as [string, string][]) {
                H.pair(x + '>' + y, y + '>' + x);
                H.send(x + '>' + y, streams[x]);
                H.send(y + '>' + x, streams[y]);
            }
        }, [links, media] as const);
        for (const [x, y] of links) {
            await peers.waitReceiving(x + '>' + y, media[y]);
            await peers.waitReceiving(y + '>' + x, media[x]);
        }
        await peers.expectHealthy(...links.flatMap(([x, y]) => [x + '>' + y, y + '>' + x]));
    });
});

test.describe('the other side vanishing', () => {
    test.describe.configure({ timeout: 90_000 });
    test('the other tab is closed without warning', async ({ playwright, browserName, launchOptions }) => {
        const { one, two, link, close } = await openLinkedPages(playwright[browserName], launchOptions);
        await link('a', 'b');
        await one.send('a', { tone: 400, video: red });
        await two.send('b', { tone: 1000, video: blue });
        await one.waitReceiving('a', { tone: 1000, video: blue });
        await two.waitReceiving('b', { tone: 400, video: red });
        const start = Date.now();
        await two.page.close({ runBeforeUnload: false });
        await one.waitClosed('a', 45_000);
        console.log(`[${test.info().project.name}] closed tab noticed after ${Date.now() - start}ms`);
        await one.expectHealthy('a');
        await close();
    });

    test('the other browser crashes', async ({ playwright, browserName, launchOptions }) => {
        test.skip(browserName !== 'chromium', 'Crashing a page needs the Chrome DevTools Protocol');
        const { one, two, link, close } = await openLinkedPages(playwright[browserName], launchOptions);
        await link('a', 'b');
        await one.send('a', { tone: 400, video: red });
        await two.send('b', { tone: 1000, video: blue });
        await one.waitReceiving('a', { tone: 1000, video: blue });
        const start = Date.now();
        const cdp = await two.page.context().newCDPSession(two.page);
        cdp.send('Page.crash').catch(() => { });
        await one.waitClosed('a', 45_000);
        console.log(`[${test.info().project.name}] crashed tab noticed after ${Date.now() - start}ms`);
        await one.expectHealthy('a');
        await close();
    });
});
