export interface IBroker {
    Open(): Promise<void>
    Send(payload: any, type: string, connectionId: string): void
    GetLocalClientId(): string;
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
    private roomId: string;
    private fromId: string;
    private sessionId: string;

    public OnMessage: OnMessageDelegate;

    public constructor(roomId: string, fromId: string, sessionId: string) {
        this.roomId = roomId;
        this.fromId = fromId;
        this.sessionId = sessionId;
    }
    GetLocalClientId(): string {
        return this.fromId;
    }

    public async Open(): Promise<void> {
        this.socket = new WebSocket("wss://c4x3tpp039.execute-api.eu-west-1.amazonaws.com/default");
        this.socket.onmessage = (event: MessageEvent) => this.OnMessageInternal(event);
        this.socket.onerror = (event: ErrorEvent) => console.error(event);
        this.socket.onclose = () => this.Open();
        this.Ping();
        return new Promise(resolve => this.socket.onopen = () => {
            this.Send(this.sessionId, "discover", this.fromId);
            resolve();
        });
    }

    private Ping(): void {
        setTimeout(() => this.Ping(), 60000);

        if (this.socket != null && this.socket.readyState == 1) {
            this.Send(null, "ping", this.fromId);
        }
    }

    private OnMessageInternal(event: MessageEvent): void {
        const data: any = JSON.parse(event.data);
        const envelope: Envelope = new Envelope();
        envelope.Data = JSON.parse(data["data"]);
        envelope.RoomId = data["roomId"];
        envelope.Type = data["type"];
        envelope.FromId = data["fromId"];
        console.info("Received: " + envelope.Type);
        this.OnMessage(envelope);
    }

    public Send(payload: any, type: string, toId: string): void {
        const serialized: string = JSON.stringify({
            roomId: this.roomId,
            toId: toId,
            fromId: this.fromId,
            type: type,
            data: JSON.stringify(payload)
        });
        console.info("Sent: " + type)
        this.socket.send(serialized);
    }
}