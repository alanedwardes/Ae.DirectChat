import { ISessionConfig } from "./SessionConfig";

export interface IBroker {
    Open(): Promise<void>
    Send(payload: any, type: string, connectionId: string): void
    OnMessage: OnMessageDelegate;
}

export class Envelope {
    public RoomId: string;
    public FromId: string;
    public Type: string;
    public Data: any;
}

interface OnMessageDelegate {
    (message: Envelope): void;
}

interface OnTrafficDelegate {
    (direction: string, data: any): void;
}

export class Broker implements IBroker {
    private socket: WebSocket;

    public OnMessage: OnMessageDelegate;
    public OnTraffic: OnTrafficDelegate;
    private readonly sessionConfig: ISessionConfig;
    private pingIntervalHandle: number = 0;

    public constructor(sessionConfig: ISessionConfig) {
        this.sessionConfig = sessionConfig;
    }

    public async Open(): Promise<void> {
        this.socket = new WebSocket("wss://c4x3tpp039.execute-api.eu-west-1.amazonaws.com/default");
        this.socket.onmessage = (event: MessageEvent) => this.OnMessageInternal(event);
        this.socket.onerror = (event: ErrorEvent) => console.error(event);
        this.socket.onclose = () => {
            if (this.pingIntervalHandle) {
                clearInterval(this.pingIntervalHandle);
                this.pingIntervalHandle = 0;
            }
            this.Open();
        };
        if (this.pingIntervalHandle) {
            clearInterval(this.pingIntervalHandle);
            this.pingIntervalHandle = 0;
        }
        this.pingIntervalHandle = window.setInterval(() => {
            this.Send(this.sessionConfig.SessionId, "ping", this.sessionConfig.RoomId);
        }, 30_000);
        return new Promise(resolve => this.socket.onopen = () => {
            this.Send(this.sessionConfig.SessionId, "discover", this.sessionConfig.RoomId);
            resolve();
        });
    }

    private OnMessageInternal(event: MessageEvent): void {
        const data: any = JSON.parse(event.data);

        // Ignore keep-alive responses that don't carry envelope fields
        if (data["type"] === "pong") {
            return;
        }

        const envelope: Envelope = new Envelope();

        const raw = data["data"];
        if (typeof raw === "string") {
            try {
                envelope.Data = JSON.parse(raw);
            } catch {
                envelope.Data = raw;
            }
        } else {
            envelope.Data = raw ?? null;
        }

        envelope.RoomId = data["roomId"];
        envelope.Type = data["type"];
        envelope.FromId = data["fromId"];
        if (this.OnTraffic) {
            this.OnTraffic("in", envelope);
        }
        this.OnMessage(envelope);
    }

    public Send(payload: any, type: string, toId: string): void {
        const serialized: string = JSON.stringify({
            roomId: this.sessionConfig.RoomId,
            toId: toId,
            fromId: this.sessionConfig.AttendeeId,
            type: type,
            data: JSON.stringify(payload)
        });
        if (this.OnTraffic) {
            this.OnTraffic("out", {
                roomId: this.sessionConfig.RoomId,
                toId: toId,
                fromId: this.sessionConfig.AttendeeId,
                type: type,
                data: payload
            });
        }
        this.socket.send(serialized);
    }
}