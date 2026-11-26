import { test as base, expect, colours, openLinkedPages, Peers } from './fixtures';
import { NetProxy } from './netproxy';

const { red, green, blue, yellow } = colours;

type Call = { proxy: NetProxy; one: Peers; two: Peers };

const test = base.extend<{ call: Call }>({
    call: async ({ playwright, browserName, launchOptions }, use) => {
        const proxy = new NetProxy(['a', 'b']);
        const { one, two, link, close } = await openLinkedPages(playwright[browserName], launchOptions, proxy);
        await link('a', 'b');
        await use({ proxy, one, two });
        await close();
    },
});

test.describe.configure({ timeout: 120_000 });

async function start({ proxy, one, two }: Call) {
    await one.send('a', { tone: 400, video: red });
    await two.send('b', { tone: 1000, video: blue });
    await two.waitReceiving('b', { tone: 400, video: red }, 30_000);
    await one.waitReceiving('a', { tone: 1000, video: blue }, 30_000);
    return proxy;
}

test('all media goes through the proxy', async ({ call }) => {
    const proxy = await start(call);
    expect(proxy.stats()['a>b'].packets).toBeGreaterThan(50);
    expect(proxy.stats()['b>a'].packets).toBeGreaterThan(50);
    proxy.setBoth({ down: true });
    await call.one.send('a', { tone: 400, video: green });
    await call.two.page.waitForTimeout(1500);
    expect((await call.two.received('b')).colour).not.toBeNull();
    await expect.poll(async () => (await call.two.received('b')).colour?.[1] ?? 0).toBeLessThan(100);
    proxy.setBoth({});
    await call.two.waitReceiving('b', { tone: 400, video: green });
});

test('lossy, jittery network', async ({ call }) => {
    call.proxy.setBoth({ delayMs: 80, jitterMs: 60, loss: 0.05 });
    await start(call);
    await call.one.send('a', { tone: 700, video: green });
    await call.two.waitReceiving('b', { tone: 700, video: green }, 30_000);
    await call.two.send('b', { tone: 1000 });
    await call.one.waitReceiving('a', { tone: 1000 }, 30_000);
    await call.one.expectHealthy('a');
    await call.two.expectHealthy('b');
});

test('very bad network', async ({ call }) => {
    call.proxy.setBoth({ delayMs: 250, jitterMs: 250, loss: 0.2 });
    await start(call);
    await call.one.send('a', { tone: 700, video: yellow });
    await call.two.waitReceiving('b', { tone: 700, video: yellow }, 30_000);
});

test('low bandwidth', async ({ call }) => {
    call.proxy.setBoth({ kbps: 250, delayMs: 40 });
    await start(call);
    await call.one.send('a', { tone: 700, video: green });
    await call.two.waitReceiving('b', { tone: 700, video: green }, 30_000);
});

test('network is down while connecting, then comes up', async ({ call }) => {
    call.proxy.setBoth({ down: true });
    await call.one.send('a', { tone: 400, video: red });
    await call.two.send('b', { tone: 1000, video: blue });
    await call.one.page.waitForTimeout(5_000);
    call.proxy.setBoth({});
    await call.two.waitReceiving('b', { tone: 400, video: red }, 20_000);
    expect((await call.one.snapshot('a')).closeCount).toBe(0);
});

for (const outageMs of [1_000, 3_000]) {
    test(`a ${outageMs / 1000}s outage recovers without reconnecting`, async ({ call }) => {
        const proxy = await start(call);
        proxy.setBoth({ down: true });
        await call.one.page.waitForTimeout(outageMs);
        proxy.setBoth({});
        await call.one.send('a', { tone: 400, video: green });
        await call.two.waitReceiving('b', { tone: 400, video: green });
        for (const [peers, name] of [[call.one, 'a'], [call.two, 'b']] as const) {
            const snapshot = await peers.snapshot(name);
            expect(snapshot.closeCount, name + ' kept its connection').toBe(0);
            expect(snapshot.isConnected).toBe(true);
        }
    });
}

test('an outage long enough to report "interrupted" still recovers within the grace period', async ({ call }) => {
    const proxy = await start(call);
    proxy.setBoth({ down: true });
    const interrupted = async () => [await call.one.snapshot('a'), await call.two.snapshot('b')].some(s => s.events.some(e => e.detail === 'connection: interrupted'));
    await expect.poll(interrupted, { timeout: 30_000 }).toBe(true);
    await call.one.page.waitForTimeout(2_000);
    proxy.setBoth({});
    await call.one.send('a', { tone: 400, video: green });
    await call.two.waitReceiving('b', { tone: 400, video: green });
    for (const [peers, name] of [[call.one, 'a'], [call.two, 'b']] as const) {
        const snapshot = await peers.snapshot(name);
        expect(snapshot.closeCount, name + ' kept its connection').toBe(0);
    }
});

test('a long outage closes both sides so they can reconnect', async ({ call }) => {
    const proxy = await start(call);
    const started = Date.now();
    proxy.setBoth({ down: true });
    await call.one.waitClosed('a', 60_000);
    await call.two.waitClosed('b', 60_000);
    console.log(`[${test.info().project.name}] outage closed both sides after ${Date.now() - started}ms`);
});

test('one direction goes down', async ({ call }) => {
    const proxy = await start(call);
    const started = Date.now();
    proxy.set('a', 'b', { down: true });
    await call.one.waitClosed('a', 60_000);
    await call.two.waitClosed('b', 60_000);
    console.log(`[${test.info().project.name}] one-way outage closed both sides after ${Date.now() - started}ms`);
});

test('the disconnect timeline', async ({ call }) => {
    const proxy = await start(call);
    const started = await call.one.page.evaluate(() => Math.round(performance.now()));
    proxy.setBoth({ down: true });
    await call.one.waitClosed('a', 60_000);
    const events = (await call.one.snapshot('a')).events.filter(e => e.t >= started && e.kind !== 'stream' && !e.detail?.startsWith('media'));
    console.log(`[${test.info().project.name}] ` + events.map(e => `+${e.t - started}ms ${e.kind}${e.detail ? ' ' + e.detail : ''}`).join(', '));
});
