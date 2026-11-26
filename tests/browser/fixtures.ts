import { test as base, expect, Page, BrowserType, LaunchOptions } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NetProxy } from './netproxy';

const root = path.resolve(import.meta.dirname, '../..');
const origin = 'http://localhost';

const mounts: [string, string][] = [
    ['/harness/', path.join(root, 'tests/browser/harness')],
    ['/js/', path.join(root, 'wwwroot/js')],
    ['/lib/', path.join(root, 'wwwroot/lib')],
];

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

async function serve(page: Page) {
    await page.route(origin + '/**', async route => {
        const url = new URL(route.request().url());
        const mount = mounts.find(([prefix]) => url.pathname.startsWith(prefix));
        if (mount == null) {
            return route.fulfill({ status: 404 });
        }
        const file = path.join(mount[1], url.pathname.slice(mount[0].length));
        try {
            const body = await readFile(file);
            return route.fulfill({ body, contentType: types[path.extname(file)] ?? 'application/octet-stream' });
        } catch {
            return route.fulfill({ status: 404 });
        }
    });
}

export type Media = { tone?: number; video?: string | null };
export type Received = { colour: [number, number, number] | null; tone: number | null; video: number };
export type Snapshot = {
    name: string;
    isConnected: boolean;
    closeCount: number;
    errors: string[];
    events: { t: number; kind: string; detail?: string }[];
    remote: { audio: number; video: number } | null;
};

export class Peers {
    readonly pageErrors: string[] = [];

    constructor(readonly page: Page) {
        page.on('pageerror', err => this.pageErrors.push(String(err)));
    }

    private run<T>(code: string, ...args: unknown[]): Promise<T> {
        return this.page.evaluate(([code, args]) => new Function('H', 'args', code)((window as any).H, args), [code, args] as const) as Promise<T>;
    }

    pair(a = 'a', b = 'b') { return this.run<void>('H.pair(args[0], args[1])', a, b); }
    remote(name: string, shouldOffer: boolean) { return this.run<void>('H.remote(args[0], args[1])', name, shouldOffer); }
    deliver(name: string, json: string) { return this.run<void>('H.deliver(args[0], args[1])', name, json); }
    send(name: string, media: Media) { return this.run<void>('H.send(args[0], args[1])', name, media); }
    destroy(name: string) { return this.run<void>('H.get(args[0]).connector.Destroy()', name); }
    signal(name: string, data: unknown) { return this.run<void>('H.get(args[0]).connector.Signal(args[1])', name, data); }
    snapshot(name: string) { return this.run<Snapshot>('return H.snapshot(args[0])', name); }
    received(name: string) { return this.run<Received>('return H.received(args[0])', name); }
    setConnectTimeout(ms: number) { return this.run<void>('window.PeerConnector.connectTimeoutMs = args[0]', ms); }

    latency(from: string, to: string, delayMs: number, jitterMs = 0) {
        return this.run<void>('const c = H.channel(args[0], args[1]); c.delayMs = args[2]; c.jitterMs = args[3]', from, to, delayMs, jitterMs);
    }
    hold(from: string, to: string) { return this.run<void>('H.channel(args[0], args[1]).held = true', from, to); }
    release(from: string, to: string) { return this.run<void>('H.channel(args[0], args[1]).release()', from, to); }
    dropAll(from: string, to: string) { return this.run<void>("H.channel(args[0], args[1]).filter = () => 'drop'", from, to); }
    blockRoute(from: string, to: string) { return this.run<void>('H.channel(args[0], args[1]).blockRoute()', from, to); }
    sent(from: string, to: string) { return this.run<string[]>('return H.channel(args[0], args[1]).sent', from, to); }

    async waitConnected(...names: string[]) {
        for (const name of names) {
            await expect.poll(async () => (await this.snapshot(name)).isConnected, { message: name + ' connects' }).toBe(true);
        }
    }

    async waitReceiving(name: string, media: Media, timeout = 15_000) {
        await expect.poll(async () => describe(await this.received(name)), { timeout, message: name + ' receives ' + JSON.stringify(media) })
            .toEqual(describe(expected(media)));
    }

    async waitClosed(name: string, timeout = 15_000) {
        await expect.poll(async () => (await this.snapshot(name)).closeCount, { timeout, message: name + ' closes' }).toBeGreaterThan(0);
    }

    async expectHealthy(...names: string[]) {
        expect(this.pageErrors).toEqual([]);
        for (const name of names) {
            const snapshot = await this.snapshot(name);
            expect(snapshot.errors, name + ' errors').toEqual([]);
            expect(snapshot.closeCount, name + ' closes at most once').toBeLessThanOrEqual(1);
        }
    }
}

function expected(media: Media): Received {
    return { colour: media.video ? hexToRgb(media.video) : null, tone: media.tone ?? 440, video: media.video ? 1 : 0 };
}

const palette: Record<string, [number, number, number]> = {
    red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
    magenta: [255, 0, 255], cyan: [0, 255, 255], white: [255, 255, 255], black: [0, 0, 0],
};
function describe(r: Received) {
    let colour: string | null = null;
    if (r.colour) {
        let best = Infinity;
        for (const [name, rgb] of Object.entries(palette)) {
            const d = rgb.reduce((sum, c, i) => sum + (c - r.colour![i]) ** 2, 0);
            if (d < best) { best = d; colour = name; }
        }
    }
    return { colour, tone: r.tone == null ? null : Math.round(r.tone / 50) * 50, video: r.video };
}

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const colours = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff' };

async function openHarness(page: Page): Promise<Peers> {
    await serve(page);
    const peers = new Peers(page);
    const impl = process.env.PEER_IMPL ? '?impl=' + encodeURIComponent(process.env.PEER_IMPL) : '';
    await page.goto(origin + '/harness/harness.html' + impl);
    await page.waitForFunction(() => (window as any).harnessReady === true);
    return peers;
}

export async function openLinkedPages(browserType: BrowserType, launchOptions: LaunchOptions, proxy?: NetProxy) {
    const browsers = [await browserType.launch(launchOptions), await browserType.launch(launchOptions)];
    const pages = [await browsers[0].newPage(), await browsers[1].newPage()];
    const peers: Peers[] = [];
    const owners = new Map<string, Peers>();
    const partner = new Map<string, string>();
    let chain = Promise.resolve();
    for (const page of pages) {
        await page.exposeBinding('relayOut', (_source, from: string, json: string) => {
            const to = partner.get(from)!;
            chain = chain.then(async () => {
                const rewritten = proxy ? await proxy.rewrite(from, json) : json;
                if (rewritten != null) {
                    await owners.get(to)?.deliver(to, rewritten);
                }
            }).catch(() => { });
        });
    }
    for (const page of pages) {
        peers.push(await openHarness(page));
    }
    const link = async (a: string, b: string) => {
        owners.set(a, peers[0]);
        owners.set(b, peers[1]);
        partner.set(a, b);
        partner.set(b, a);
        await peers[1].remote(b, false);
        await peers[0].remote(a, true);
    };
    const close = async () => {
        await Promise.all(browsers.map(browser => browser.close().catch(() => { })));
        proxy?.close();
    };
    return { one: peers[0], two: peers[1], link, close };
}

export const test = base.extend<{ peers: Peers }>({
    peers: async ({ page }, use) => {
        const peers = await openHarness(page);
        await use(peers);
        await page.evaluate(() => (window as any).H.destroyAll()).catch(() => { });
    },
});

export { expect };
