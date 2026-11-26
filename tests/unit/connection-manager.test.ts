import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Room, Client, seededRandom } from './sim.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function expectMesh(room: Room) {
    room.settle();
    expect([...room.net.errors, ...room.meshProblems()]).toEqual([]);
    expect(room.quiet()).toBe(true);
}

describe('joining', () => {
    test('two clients connect', () => {
        const room = new Room();
        room.join('a');
        room.join('b');
        expectMesh(room);
    });

    test('five clients joining at once form a full mesh', () => {
        const room = new Room();
        for (let i = 0; i < 5; i++) room.join();
        expectMesh(room);
    });

    test('late joiner connects to everyone', () => {
        const room = new Room();
        room.join('a');
        room.join('b');
        room.settle(10_000);
        room.join('c');
        expectMesh(room);
    });

    test('slow, jittery signalling', () => {
        const room = new Room();
        room.net.latencyMs = 500;
        room.net.jitterMs = 1500;
        for (let i = 0; i < 4; i++) room.join();
        expectMesh(room);
    });
});

describe('leaving', () => {
    test('a clean leave is noticed straight away and never retried', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        b.leave();
        room.settle(1_000);
        expect(a.closed).toEqual([b.id]);
        expectMesh(room);
    });

    test('a crash is noticed, retried, then given up on', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        b.crash();
        room.settle();
        expect(a.closed).toEqual([b.id]);
        expectMesh(room);
    });

    test('reloading the page', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.join('c');
        room.settle(10_000);
        room.reload(b);
        expectMesh(room);
    });

    test('reloading after a crash', () => {
        const room = new Room();
        room.join('a');
        const b = room.join('b');
        room.join('c');
        room.settle(10_000);
        room.reload(b, false);
        expectMesh(room);
    });
});

describe('media changes', () => {
    test('changing media mid-call keeps everyone connected', () => {
        const room = new Room();
        const clients = [room.join(), room.join(), room.join()];
        room.settle(10_000);
        for (let i = 0; i < 10; i++) {
            clients[i % 3].manager.RefreshLocalStream();
            room.settle(200);
        }
        expectMesh(room);
    });

    test('changing media while a reconnect is under way', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        room.breakLink(a, b, 1_000, 1_000);
        for (let t = 0; t < 20; t++) {
            room.settle(250);
            (t % 2 ? a : b).manager.RefreshLocalStream();
        }
        expectMesh(room);
    });
});

describe('reconnect races', () => {
    function meshWithin(room: Room, ms: number) {
        room.settle(ms);
        expect([...room.net.errors, ...room.meshProblems()]).toEqual([]);
    }

    test('both sides retry at the same moment and pair up on the first attempt', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const room = new Room(seed);
            room.net.latencyMs = 800;
            room.net.jitterMs = 0;
            const a = room.join('a');
            const b = room.join('b');
            room.settle(10_000);
            room.breakLink(a, b, 1_000, 1_000);
            meshWithin(room, 8_000);
        }
    });

    test('the side that noticed retries while the other keeps signalling on the old connection', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const room = new Room(seed);
            room.net.latencyMs = 200;
            const a = room.join('a');
            const b = room.join('b');
            room.settle(10_000);
            room.breakLink(a, b, 100, 6_000);
            for (let t = 0; t < 30; t++) {
                room.settle(200);
                b.manager.RefreshLocalStream();
            }
            meshWithin(room, 15_000);
        }
    });
});

describe('connection trouble', () => {
    test('the link drops and both sides notice at once', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        room.breakLink(a, b, 5_000, 5_000);
        expectMesh(room);
    });

    test('the link drops and one side notices much later', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        room.breakLink(a, b, 100, 16_000);
        expectMesh(room);
    });

    test('the link drops and only one side ever notices', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        a.peer(b.id)!.breakLink(100);
        expectMesh(room);
    });

    test('two clients that can never connect give up instead of retrying forever', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.net.partition(a.id, b.id);
        room.settle();
        expect(room.quiet()).toBe(true);
        expect(a.closed).toEqual([b.id]);
        expect(b.closed).toEqual([a.id]);
    });

    test('a temporary partition heals within the retry window', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        room.net.partition(a.id, b.id);
        room.breakLink(a, b, 5_000, 5_000);
        room.settle(20_000);
        room.net.heal(a.id, b.id);
        expectMesh(room);
    });

    test('the websocket drops and comes back mid-call', () => {
        const room = new Room();
        const a = room.join('a');
        room.join('b');
        room.join('c');
        room.settle(10_000);
        const connectors = a.connectors.length;
        a.reconnectSocket(3_000);
        expectMesh(room);
        expect(a.connectors.length).toBe(connectors);
    });

    test('every websocket drops at once, as on a server restart', () => {
        const room = new Room();
        for (let i = 0; i < 3; i++) room.join();
        room.settle(10_000);
        room.clients.forEach((c, i) => c.reconnectSocket(1_000 + i * 700));
        expectMesh(room);
    });

    test('the link and the websocket drop together', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        a.reconnectSocket(8_000);
        room.breakLink(a, b, 2_000, 2_000);
        expectMesh(room);
    });

    test('the websocket is down for longer than the retries last', () => {
        const room = new Room();
        const a = room.join('a');
        const b = room.join('b');
        room.settle(10_000);
        a.reconnectSocket(200_000);
        room.breakLink(a, b, 2_000, 2_000);
        expectMesh(room);
    });
});

describe('random sequences of events', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

    test.each(seeds)('seed %i', seed => {
        const room = new Room(seed);
        const random = seededRandom(seed * 7919);
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
        room.net.latencyMs = Math.floor(random() * 300);
        room.net.jitterMs = Math.floor(random() * 1000);

        for (let i = 0; i < 2 + Math.floor(random() * 3); i++) room.join();
        const log: string[] = [];

        for (let step = 0; step < 12; step++) {
            room.settle(Math.floor(random() * 25_000));
            const present = room.present;
            const roll = random();
            if (roll < 0.15 || present.length < 2) {
                log.push('join ' + room.join().name);
            } else if (roll < 0.3) {
                const c = pick(present);
                log.push('leave ' + c.name);
                c.leave();
            } else if (roll < 0.4) {
                const c = pick(present);
                log.push('crash ' + c.name);
                c.crash();
            } else if (roll < 0.55) {
                const c = pick(present);
                log.push('reload ' + c.name);
                room.reload(c, random() < 0.5);
            } else if (roll < 0.62) {
                const c = pick(present);
                log.push('media ' + c.name);
                c.manager.RefreshLocalStream();
            } else if (roll < 0.75) {
                const [x, y] = [pick(present), pick(present)];
                if (x !== y) {
                    const dx = Math.floor(random() * 20_000), dy = Math.floor(random() * 20_000);
                    log.push(`break ${x.name}-${y.name} ${dx}/${dy}`);
                    room.breakLink(x, y, dx, dy);
                }
            } else if (roll < 0.9) {
                const c = pick(present);
                const down = Math.floor(random() * 10_000);
                log.push(`socket ${c.name} ${down}`);
                c.reconnectSocket(down);
            } else {
                const [x, y] = [pick(present), pick(present)];
                if (x !== y) {
                    log.push(`partition ${x.name}-${y.name}`);
                    room.net.partition(x.id, y.id);
                    room.settle(Math.floor(random() * 10_000));
                    room.net.heal(x.id, y.id);
                }
            }
        }

        room.settle();
        const problems = [...room.net.errors, ...room.meshProblems()];
        expect({ log, problems }).toEqual({ log, problems: [] });
    });
});
