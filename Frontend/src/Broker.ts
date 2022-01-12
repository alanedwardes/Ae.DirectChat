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

export class Broker implements IBroker {
    private socket: WebSocket;

    public OnMessage: OnMessageDelegate;
    private readonly sessionConfig: ISessionConfig;

    public constructor(sessionConfig: ISessionConfig) {
        this.sessionConfig = sessionConfig;
    }

    public async Open(): Promise<void> {
        this.socket = new WebSocket("wss://c4x3tpp039.execute-api.eu-west-1.amazonaws.com/default");
        this.socket.onmessage = (event: MessageEvent) => this.OnMessageInternal(event);
        this.socket.onerror = (event: ErrorEvent) => console.error(event);
        this.socket.onclose = () => this.Open();
        setInterval(() => {
            this.Send(this.sessionConfig.SessionId, "ping", this.sessionConfig.RoomId);
        }, 30_000);
        return new Promise(resolve => this.socket.onopen = () => {
            this.Send(this.sessionConfig.SessionId, "discover", this.sessionConfig.RoomId);
            resolve();
        });
    }

    private OnMessageInternal(event: MessageEvent): void {
        const data: any = JSON.parse(event.data);
        const envelope: Envelope = new Envelope();
        envelope.Data = JSON.parse(data["data"]);
        envelope.RoomId = data["roomId"];
        envelope.Type = data["type"];
        envelope.FromId = data["fromId"];
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
        this.socket.send(serialized);
    }
}