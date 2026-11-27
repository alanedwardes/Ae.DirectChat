import { test, expect } from '@playwright/test';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { port } from '../../playwright.e2e.config';

const origin = `http://localhost:${port}`;

class RawClient {
    public messages: any[] = [];
    public closeCode: number | null = null;
    public closed = false;
    private buffer = Buffer.alloc(0);

    private constructor(private readonly socket: net.Socket, public readonly status: number) { }

    static connect(requestOrigin: string | null = origin): Promise<RawClient> {
        return new Promise((resolve, reject) => {
            const socket = net.connect(port, 'localhost');
            let head = Buffer.alloc(0);
            const onData = (chunk: Buffer) => {
                head = Buffer.concat([head, chunk]);
                const end = head.indexOf('\r\n\r\n');
                if (end < 0) {
                    return;
                }
                socket.off('data', onData);
                const status = Number(head.subarray(0, end).toString().split(' ')[1]);
                const client = new RawClient(socket, status);
                socket.on('data', data => client.onData(data));
                socket.on('close', () => client.closed = true);
                client.onData(head.subarray(end + 4));
                resolve(client);
            };
            socket.on('data', onData);
            socket.on('error', reject);
            socket.write([
                'GET /ws HTTP/1.1',
                `Host: localhost:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
                'Sec-WebSocket-Version: 13',
                ...(requestOrigin ? [`Origin: ${requestOrigin}`] : []),
                '', ''
            ].join('\r\n'));
        });
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 2) {
            const opcode = this.buffer[0] & 0x0f;
            let length = this.buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (this.buffer.length < 4) return;
                length = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (this.buffer.length < 10) return;
                length = Number(this.buffer.readBigUInt64BE(2));
                offset = 10;
            }
            if (this.buffer.length < offset + length) return;
            const payload = this.buffer.subarray(offset, offset + length);
            this.buffer = this.buffer.subarray(offset + length);
            if (opcode === 1) {
                this.messages.push(JSON.parse(payload.toString()));
            } else if (opcode === 8) {
                this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
            }
        }
    }

    sendRaw(text: string): void {
        const payload = Buffer.from(text);
        const mask = randomBytes(4);
        const header = payload.length < 126
            ? Buffer.from([0x81, 0x80 | payload.length])
            : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
        const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
        this.socket.write(Buffer.concat([header, mask, masked]));
    }

    send(roomId: string, fromId: string, toId: string, type: string, data: unknown): void {
        this.sendRaw(JSON.stringify({ roomId, fromId, toId, type, data: JSON.stringify(data) }));
    }

    stopReading(): void {
        this.socket.pause();
    }

    destroy(): void {
        this.socket.destroy();
    }

    received(type: string, fromId?: string): boolean {
        return this.messages.some(m => m.type === type && (fromId == null || m.fromId === fromId));
    }
}

const clients: RawClient[] = [];

async function connect(requestOrigin?: string | null): Promise<RawClient> {
    const client = await RawClient.connect(requestOrigin === undefined ? origin : requestOrigin);
    clients.push(client);
    return client;
}

async function join(roomId: string, clientId: string = randomUUID(), sessionId: string = randomUUID()): Promise<RawClient> {
    const client = await connect();
    client.send(roomId, clientId, roomId, 'discover', sessionId);
    return client;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test.afterEach(() => {
    clients.splice(0).forEach(client => client.destroy());
});

test('origins not in ALLOWED_ORIGINS are refused', async () => {
    expect((await connect()).status).toBe(101);
    expect((await connect('https://evil.example')).status).toBe(403);
    expect((await connect(null)).status).toBe(403);
});

test('a socket that never joins a room is closed', async () => {
    const idle = await connect();
    await expect.poll(() => idle.closed, { timeout: 15_000 }).toBe(true);
});

test('a full room refuses more clients until someone leaves', async () => {
    const room = randomUUID();
    const members: RawClient[] = [];
    for (let i = 0; i < 16; i++) {
        members.push(await join(room));
    }

    const extra = await join(room);
    await expect.poll(() => extra.closeCode).toBe(4000);

    members.pop().destroy();
    await pause(500);

    const late = randomUUID();
    const replacement = await join(room, late);
    await expect.poll(() => members[0].received('discover', late)).toBe(true);
    expect(replacement.closeCode).toBeNull();
});

test("a departed client's ID can only be reclaimed by its own session", async () => {
    const room = randomUUID();
    const victimId = randomUUID();
    const victimSession = randomUUID();
    const observerId = randomUUID();
    const observer = await join(room, observerId);
    const victim = await join(room, victimId, victimSession);
    await expect.poll(() => observer.received('discover', victimId)).toBe(true);

    victim.destroy();
    await pause(500);
    observer.messages = [];

    const impostor = await join(room, victimId, randomUUID());
    impostor.send(room, victimId, observerId, 'offer', { type: 'offer', sdp: 'x' });
    await pause(1000);
    expect(observer.received('discover', victimId)).toBe(false);
    expect(observer.received('offer', victimId)).toBe(false);

    await join(room, victimId, victimSession);
    await expect.poll(() => observer.received('discover', victimId)).toBe(true);
});

test('a client that stops reading does not block anyone else', async () => {
    const room = randomUUID();
    const sinkId = randomUUID();
    const sender = await join(room);
    const sink = await join(room, sinkId);
    await expect.poll(() => sender.received('discover', sinkId)).toBe(true);
    sink.stopReading();

    const sdp = 'x'.repeat(60 * 1024);
    for (let i = 0; i < 80; i++) {
        sender.send(room, randomUUID(), sinkId, 'offer', { type: 'offer', sdp });
    }

    sender.messages = [];
    sender.send(room, randomUUID(), room, 'ping', null);
    await expect.poll(() => sender.received('pong'), { timeout: 5_000 }).toBe(true);

    const newcomerId = randomUUID();
    await join(room, newcomerId);
    await expect.poll(() => sender.received('discover', newcomerId), { timeout: 5_000 }).toBe(true);
});
