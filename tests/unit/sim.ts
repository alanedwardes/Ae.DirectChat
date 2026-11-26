import { vi } from 'vitest';
import type { IBroker, Envelope } from '../../ts/Broker.js';
import type { IPeerConnector, OnConnectionChangedDelegate } from '../../ts/PeerConnector.js';
import type { IPeerConnectorFactory } from '../../ts/PeerConnectorFactory.js';
import type { ISessionConfig } from '../../ts/SessionConfig.js';

(globalThis as any).window ??= globalThis;
const { ConnectionManager } = await import('../../ts/ConnectionManager.js');

export function seededRandom(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class Network {
    readonly random: () => number;
    readonly sockets = new Map<string, FakeBroker>();
    readonly connectors = new Map<string, FakeConnector>();
    readonly partitions = new Set<string>();
    readonly errors: string[] = [];
    latencyMs = 20;
    jitterMs = 30;
    connectDelayMs = 300;
    closeDetectMs = 50;
    vanishDetectMs = 16_000;
    messageCount = 0;
    private lastDue = new Map<string, number>();
    private nextConnector = 0;

    constructor(seed = 1) {
        this.random = seededRandom(seed);
        vi.spyOn(Math, 'random').mockImplementation(this.random);
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    }

    uuid(): string {
        const hex = () => Math.floor(this.random() * 16).toString(16);
        return Array.from({ length: 32 }, hex).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    }

    connectorId(): string {
        return 'c' + this.nextConnector++;
    }

    partition(x: string, y: string) { this.partitions.add([x, y].sort().join('|')); }
    heal(x: string, y: string) { this.partitions.delete([x, y].sort().join('|')); }
    isPartitioned(x: string, y: string) { return this.partitions.has([x, y].sort().join('|')); }

    route(from: FakeBroker, wire: string) {
        const envelope = JSON.parse(wire);
        this.messageCount++;
        if (envelope.type === 'ping') {
            return;
        }
        if (envelope.type === 'discover') {
            this.sockets.set(envelope.fromId, from);
            for (const [id, socket] of this.sockets) {
                if (id !== envelope.fromId && socket.roomId === envelope.roomId) {
                    this.deliver(socket, envelope);
                }
            }
            return;
        }
        if (envelope.type === 'acknowledge') {
            envelope.data = null;
        }
        const to = this.sockets.get(envelope.toId);
        if (to != null) {
            this.deliver(to, envelope);
        }
    }

    private deliver(to: FakeBroker, envelope: any) {
        const wire = JSON.stringify(envelope);
        const due = Math.max(this.lastDue.get(to.id) ?? 0, Date.now() + this.latencyMs + this.random() * this.jitterMs);
        this.lastDue.set(to.id, due);
        const socket = to.socket;
        setTimeout(() => to.receive(socket, wire), due - Date.now());
    }
}

export class FakeBroker implements IBroker {
    OnMessage: (message: Envelope) => void;
    socket = 0;
    open = false;

    constructor(private readonly net: Network, private readonly config: ISessionConfig) { }

    get id() { return this.config.AttendeeId; }
    get roomId() { return this.config.RoomId; }

    async Open(): Promise<void> {
        this.socket++;
        this.open = true;
        this.Send(this.config.SessionId, 'discover', this.config.RoomId);
    }

    Send(payload: any, type: string, toId: string): void {
        if (!this.open) {
            throw new Error('socket closed');
        }
        this.net.route(this, JSON.stringify({ roomId: this.config.RoomId, toId, fromId: this.config.AttendeeId, type, data: JSON.stringify(payload) }));
    }

    close() {
        this.open = false;
        if (this.net.sockets.get(this.id) === this) {
            this.net.sockets.delete(this.id);
        }
    }

    receive(socket: number, wire: string) {
        if (!this.open || socket !== this.socket) {
            return;
        }
        const data = JSON.parse(wire);
        let parsed: any = data.data;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { }
        }
        this.OnMessage({ RoomId: data.roomId, FromId: data.fromId, Type: data.type, Data: parsed ?? null });
    }
}

export class FakeConnector implements IPeerConnector {
    static readonly connectTimeoutMs = 15_000;

    readonly id: string;
    partner: FakeConnector | null = null;
    hasRemote = false;
    isConnected = false;
    isClosed = false;
    sentStreams = 0;
    pendingOffer = false;
    private pendingCandidates: string[] = [];
    private timers: ReturnType<typeof setTimeout>[] = [];

    OnConnectionChanged: OnConnectionChangedDelegate;
    OnSendMessage: (payload: any, type: string) => void;
    OnHasStream: (stream: MediaStream) => void;
    OnConnect: () => void;
    OnClose: () => void;

    constructor(private readonly net: Network, readonly owner: string, readonly shouldOffer: boolean) {
        this.id = net.connectorId();
        net.connectors.set(this.id, this);
        this.later(FakeConnector.connectTimeoutMs, () => {
            if (!this.isConnected) {
                this.OnConnectionChanged('timed out', 'connection');
                this.Shutdown();
            }
        });
        if (shouldOffer) {
            this.later(0, () => {
                this.makeOffer();
                this.trickleCandidates();
            });
        }
    }

    get IsConnected() { return this.isConnected && !this.isClosed; }

    private later(ms: number, fn: () => void) {
        this.timers.push(setTimeout(() => { if (!this.isClosed) fn(); }, ms));
    }

    private emit(signal: any) {
        try {
            this.OnSendMessage(signal, signal.type);
        } catch (err) {
            this.net.errors.push(`${this.id} OnSendMessage threw: ${err}`);
        }
    }

    private makeOffer() {
        this.pendingOffer = true;
        this.emit({ type: 'offer', sdp: this.id });
    }

    private trickleCandidates() {
        const delays = [this.net.random() * 50, 50 + this.net.random() * 300, 500 + this.net.random() * 2500];
        delays.forEach((ms, i) => this.later(ms, () => this.emit({ type: 'candidate', candidate: { candidate: this.id + ' ' + i, sdpMid: '0' } })));
    }

    private fail(reason: string) {
        this.net.errors.push(`${this.id} ${reason}`);
        this.OnConnectionChanged('error: ' + reason, 'connection');
        this.Shutdown();
    }

    Signal(data: any): void {
        if (this.isClosed || data == null) {
            return;
        }
        switch (data.type) {
            case 'offer': {
                if (this.shouldOffer) {
                    return this.fail('offer received by offerer');
                }
                if (this.partner != null) {
                    if (data.sdp !== this.partner.id) {
                        return this.fail('offer from a different connection');
                    }
                    this.emit({ type: 'answer', sdp: this.id, offer: data.sdp });
                    return;
                }
                this.partner = this.net.connectors.get(data.sdp) ?? null;
                this.hasRemote = true;
                this.emit({ type: 'answer', sdp: this.id, offer: data.sdp });
                this.trickleCandidates();
                this.flushCandidates();
                this.tryConnect();
                return;
            }
            case 'answer': {
                if (!this.shouldOffer) {
                    return this.fail('answer received by answerer');
                }
                if (!this.pendingOffer) {
                    return this.fail('answer received in stable state');
                }
                this.pendingOffer = false;
                if (this.hasRemote) {
                    return data.sdp === this.partner?.id ? undefined : this.fail('answer from a different connection');
                }
                this.hasRemote = true;
                this.partner = data.offer === this.id ? this.net.connectors.get(data.sdp) ?? null : null;
                this.flushCandidates();
                this.tryConnect();
                return;
            }
            case 'renegotiate': {
                if (this.shouldOffer && this.isConnected && !this.pendingOffer) {
                    this.makeOffer();
                }
                return;
            }
            case 'candidate': {
                const from = String(data.candidate?.candidate ?? '').split(' ')[0];
                if (!this.hasRemote) {
                    this.pendingCandidates.push(from);
                    return;
                }
                if (this.partner == null || from !== this.partner.id) {
                    return this.fail('candidate from a different connection');
                }
                return;
            }
        }
    }

    private flushCandidates() {
        const pending = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const from of pending) {
            if (this.partner == null || from !== this.partner.id) {
                return this.fail('candidate from a different connection');
            }
        }
    }

    private tryConnect() {
        const partner = this.partner;
        if (partner == null || partner.partner !== this || !partner.hasRemote || !this.hasRemote) {
            return;
        }
        this.later(this.net.connectDelayMs, () => {
            if (partner.isClosed || this.isConnected || this.net.isPartitioned(this.owner, partner.owner)) {
                return;
            }
            this.markConnected();
            partner.markConnected();
        });
    }

    private markConnected() {
        if (this.isConnected || this.isClosed) {
            return;
        }
        this.isConnected = true;
        this.OnConnectionChanged('connected', 'connection');
        this.OnConnect?.();
        this.OnHasStream({ id: 'stream-' + this.partner!.id } as unknown as MediaStream);
    }

    breakLink(detectMs: number) {
        this.later(detectMs, () => {
            this.OnConnectionChanged('lost', 'connection');
            this.Shutdown();
        });
    }

    SendStream(_stream: MediaStream): void {
        if (this.isClosed) {
            return;
        }
        this.sentStreams++;
        if (!this.isConnected) {
            return;
        }
        if (!this.shouldOffer) {
            this.emit({ type: 'renegotiate', renegotiate: true });
        } else if (!this.pendingOffer) {
            this.makeOffer();
        }
    }

    Destroy(): void {
        const partner = this.isConnected ? this.partner : null;
        this.Shutdown();
        partner?.breakLink(this.net.closeDetectMs);
    }

    vanish() {
        const partner = this.isConnected ? this.partner : null;
        this.isClosed = true;
        this.timers.forEach(clearTimeout);
        partner?.breakLink(this.net.vanishDetectMs);
    }

    private Shutdown() {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;
        this.timers.forEach(clearTimeout);
        this.OnClose();
    }
}

export class Client {
    readonly config: ISessionConfig;
    readonly broker: FakeBroker;
    readonly manager: InstanceType<typeof ConnectionManager>;
    readonly closed: string[] = [];
    readonly streams = new Map<string, string>();
    readonly connectors: FakeConnector[] = [];
    present = false;

    constructor(readonly net: Network, readonly name: string, roomId: string) {
        this.config = { SessionId: net.uuid(), AttendeeId: net.uuid(), RoomId: roomId };
        this.broker = new FakeBroker(net, this.config);
        const factory: IPeerConnectorFactory = {
            CreatePeerConnector: (shouldOffer: boolean) => {
                const connector = new FakeConnector(net, this.id, shouldOffer);
                this.connectors.push(connector);
                return connector;
            },
        };
        this.manager = new ConnectionManager(this.broker, this.config, factory);
        this.manager.OnNeedLocalStream = () => ({ id: 'local-' + name } as unknown as MediaStream);
        this.manager.OnHasStream = (fromId, stream) => this.streams.set(fromId, stream.id);
        this.manager.OnStreamEnded = fromId => this.streams.delete(fromId);
        this.manager.OnConnectionChanged = () => { };
        this.manager.OnLocation = () => { };
        this.manager.OnClose = fromId => this.closed.push(fromId);
    }

    get id() { return this.config.AttendeeId; }

    peer(otherId: string): FakeConnector | undefined {
        return (this.manager as any).peers[otherId]?.connector;
    }

    join() {
        this.present = true;
        this.broker.Open();
    }

    leave() {
        this.manager.Leave();
        this.connectors.forEach(c => c.Destroy());
        this.die();
    }

    crash() {
        this.connectors.forEach(c => c.vanish());
        this.die();
    }

    private die() {
        this.broker.close();
        this.present = false;
        const timers = (this.manager as any).retryTimers;
        Object.keys(timers).forEach(id => { clearTimeout(timers[id]); delete timers[id]; });
        this.manager.OnClose = () => { };
    }

    reconnectSocket(downMs: number) {
        this.broker.close();
        setTimeout(() => { if (this.present) this.broker.Open(); }, downMs);
    }
}

export class Room {
    readonly net: Network;
    readonly clients: Client[] = [];
    readonly roomId: string;

    constructor(seed = 1) {
        this.net = new Network(seed);
        this.roomId = this.net.uuid();
    }

    add(name = 'c' + this.clients.length) {
        const client = new Client(this.net, name, this.roomId);
        this.clients.push(client);
        return client;
    }

    join(name?: string) {
        const client = this.add(name);
        client.join();
        return client;
    }

    reload(client: Client, graceful = true) {
        graceful ? client.leave() : client.crash();
        return this.join(client.name + "'");
    }

    breakLink(x: Client, y: Client, xDetectMs: number, yDetectMs: number) {
        x.peer(y.id)?.breakLink(xDetectMs);
        y.peer(x.id)?.breakLink(yDetectMs);
    }

    get present() { return this.clients.filter(c => c.present); }

    settle(ms = 300_000) {
        const step = 1000;
        for (let t = 0; t < ms; t += step) {
            vi.advanceTimersByTime(step);
        }
    }

    meshProblems(): string[] {
        const problems: string[] = [];
        const present = this.present;
        for (const x of present) {
            for (const y of present) {
                if (x === y) continue;
                const cx = x.peer(y.id);
                const cy = y.peer(x.id);
                if (cx == null) { problems.push(`${x.name} has no connector to ${y.name}`); continue; }
                if (!cx.IsConnected) problems.push(`${x.name} -> ${y.name} not connected`);
                else if (cx.partner !== cy) problems.push(`${x.name} -> ${y.name} connected to a stale connector`);
                if (!x.streams.has(y.id)) problems.push(`${x.name} has no stream from ${y.name}`);
            }
            const live = x.connectors.filter(c => !c.isClosed).length;
            if (live !== present.length - 1) problems.push(`${x.name} has ${live} live connectors, expected ${present.length - 1}`);
            for (const gone of this.clients.filter(c => !c.present)) {
                if (x.peer(gone.id) != null) problems.push(`${x.name} still has a connector to departed ${gone.name}`);
                if (x.streams.has(gone.id)) problems.push(`${x.name} still shows a stream from departed ${gone.name}`);
            }
        }
        return problems;
    }

    quiet(ms = 120_000): boolean {
        const before = this.net.messageCount;
        this.settle(ms);
        return this.net.messageCount === before;
    }
}
