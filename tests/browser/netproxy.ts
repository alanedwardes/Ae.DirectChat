import dgram from 'node:dgram';

export type Conditions = {
    delayMs?: number;
    jitterMs?: number;
    loss?: number;
    kbps?: number;
    down?: boolean;
};

type Address = { address: string; port: number };

class Link {
    conditions: Conditions = {};
    packets = 0;
    dropped = 0;
    private nextFree = 0;

    send(bytes: number, deliver: () => void) {
        this.packets++;
        const c = this.conditions;
        if (c.down || (c.loss && Math.random() < c.loss)) {
            this.dropped++;
            return;
        }
        const now = performance.now();
        let start = now;
        if (c.kbps) {
            start = Math.max(now, this.nextFree);
            if (start - now > 300) {
                this.dropped++;
                return;
            }
            this.nextFree = start + (bytes * 8) / c.kbps;
        }
        const due = start + (c.delayMs ?? 0) + Math.random() * (c.jitterMs ?? 0);
        if (due - now < 1) {
            deliver();
        } else {
            setTimeout(deliver, due - now);
        }
    }
}

export class NetProxy {
    private readonly links = new Map<string, Link>();
    private readonly sockets: dgram.Socket[] = [];
    private readonly mapped = new Map<string, Promise<Address>>();
    private closed = false;

    constructor(private readonly peers: [string, string]) {
        for (const [x, y] of [peers, [peers[1], peers[0]]]) {
            this.links.set(x + '>' + y, new Link());
        }
    }

    link(from: string, to: string): Link {
        return this.links.get(from + '>' + to)!;
    }

    set(from: string, to: string, conditions: Conditions) {
        this.link(from, to).conditions = conditions;
    }

    setBoth(conditions: Conditions) {
        this.set(this.peers[0], this.peers[1], conditions);
        this.set(this.peers[1], this.peers[0], conditions);
    }

    stats() {
        return Object.fromEntries([...this.links].map(([k, l]) => [k, { packets: l.packets, dropped: l.dropped }]));
    }

    private other(name: string) {
        return name === this.peers[0] ? this.peers[1] : this.peers[0];
    }

    private map(owner: string, real: Address): Promise<Address> {
        const key = `${owner} ${real.address}:${real.port}`;
        let mapping = this.mapped.get(key);
        if (mapping == null) {
            mapping = new Promise<Address>((resolve, reject) => {
                const socket = dgram.createSocket('udp4');
                this.sockets.push(socket);
                let far: Address | null = null;
                socket.on('message', (msg, from) => {
                    if (from.address === real.address && from.port === real.port) {
                        const to = far;
                        if (to != null) {
                            this.link(owner, this.other(owner)).send(msg.length, () => this.forward(socket, msg, to));
                        }
                    } else {
                        far = { address: from.address, port: from.port };
                        this.link(this.other(owner), owner).send(msg.length, () => this.forward(socket, msg, real));
                    }
                });
                socket.on('error', reject);
                socket.bind(0, real.address, () => resolve({ address: real.address, port: socket.address().port }));
            });
            this.mapped.set(key, mapping);
        }
        return mapping;
    }

    private forward(socket: dgram.Socket, msg: Buffer, to: Address) {
        if (!this.closed) {
            socket.send(msg, to.port, to.address);
        }
    }

    async rewrite(from: string, json: string): Promise<string | null> {
        const payload = JSON.parse(json);
        if (typeof payload.sdp === 'string') {
            payload.sdp = payload.sdp.replace(/a=candidate:[^\r\n]*\r?\n/g, '');
        }
        const line: string | undefined = payload.candidate?.candidate;
        if (typeof line === 'string' && line.length > 0) {
            const parts = line.split(' ');
            const [protocol, address, port, type] = [parts[2]?.toLowerCase(), parts[4], Number(parts[5]), parts[7]];
            if (protocol !== 'udp' || type !== 'host' || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
                return null;
            }
            const proxied = await this.map(from, { address, port });
            parts[4] = proxied.address;
            parts[5] = String(proxied.port);
            payload.candidate.candidate = parts.join(' ');
        }
        return JSON.stringify(payload);
    }

    close() {
        this.closed = true;
        this.sockets.forEach(socket => { try { socket.close(); } catch { } });
    }
}
