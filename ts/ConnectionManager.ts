import { IBroker, Envelope } from "./Broker.js";
import { IPeerConnector } from "./PeerConnector.js";
import { ISessionConfig } from "./SessionConfig.js";
import { IPeerConnectorFactory } from "./PeerConnectorFactory.js";

interface OnCloseDelegate {
    (clientId: string): void;
}

interface OnHasStreamDelegate {
    (fromId: string, stream: MediaStream): void;
}

interface OnStreamEndedDelegate {
    (fromId: string): void;
}

interface OnNeedLocalStreamDelegate {
    (): MediaStream;
}

interface OnClientConnectionChangedDelegate {
    (clientId: string, change: string, category: string): void;
}

export class ClientLocation {
    CityName: string;
    CountryName: string;
    CountryCode: string;
    ContinentName: string;
    SubdivisionName: string;
}

interface OnClientLocationDelegate {
    (clientId: string, location: ClientLocation): void;
}

// Reconnection protocol (both messages are relayed peer-to-peer by the signalling server):
//  - "reconnect": the sender has thrown away its connector and made a fresh one; the receiver should do the same.
//  - "leave": the sender is closing the page; the receiver should forget it without retrying.
export class ConnectionManager {
    private static readonly retryDelaysMs: number[] = [1000, 3000, 10000, 20000];
    // A connector younger than this that hasn't connected yet is our own in-flight reconnect attempt
    private static readonly freshConnectorMs: number = 5000;

    private readonly broker: IBroker;
    public OnHasStream: OnHasStreamDelegate;
    public OnStreamEnded: OnStreamEndedDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnConnectionChanged: OnClientConnectionChangedDelegate;
    public OnLocation: OnClientLocationDelegate;
    // Fired once a client has gone for good (left, or every reconnect attempt failed)
    public OnClose: OnCloseDelegate;

    private connectors: { [fromId: string]: IPeerConnector; } = {};
    private connectorCreatedAt: { [fromId: string]: number; } = {};
    private retryAttempts: { [fromId: string]: number; } = {};
    private retryTimers: { [fromId: string]: number; } = {};
    private readonly departed: Set<string> = new Set<string>();
    private readonly sessionConfig: ISessionConfig;
    private readonly peerConnectorFactory: IPeerConnectorFactory;

    constructor(broker: IBroker, sessionConfig: ISessionConfig, peerConnectorFactory: IPeerConnectorFactory) {
        this.broker = broker;
        this.sessionConfig = sessionConfig;
        this.peerConnectorFactory = peerConnectorFactory;
        this.broker.OnMessage = (message: Envelope) => this.OnMessage(message);
    }

    public RefreshLocalStream() {
        const localStream: MediaStream = this.OnNeedLocalStream();

        for (let clientId in this.connectors) {
            if (this.connectors.hasOwnProperty(clientId)) {
                this.connectors[clientId].SendStream(localStream);
            }
        }
    }

    // Tell every peer we're going, so they remove us immediately instead of retrying
    public Leave(): void {
        const clientIds = new Set<string>([...Object.keys(this.connectors), ...Object.keys(this.retryTimers)]);
        clientIds.forEach(clientId => this.TrySend({}, "leave", clientId));
    }

    private ShouldOffer(fromId: string): boolean {
        return fromId < this.sessionConfig.AttendeeId;
    }

    private TrySend(payload: any, type: string, toId: string): void {
        try {
            this.broker.Send(payload, type, toId);
        }
        catch (err) {
            console.warn("Unable to send " + type + " to " + toId, err);
        }
    }

    private CreateConnector(fromId: string): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        const peerConnector = this.peerConnectorFactory.CreatePeerConnector(this.ShouldOffer(fromId));
        peerConnector.OnConnectionChanged = (change, category) => this.OnConnectionChanged(fromId, change, category);
        peerConnector.OnConnect = () => delete this.retryAttempts[fromId];
        peerConnector.OnClose = () => this.ProcessClose(fromId, peerConnector);
        peerConnector.OnHasStream = stream => this.OnHasStream(fromId, stream);
        peerConnector.OnSendMessage = (payload: any, type: string) => this.broker.Send(payload, type, fromId);
        this.connectors[fromId] = peerConnector;
        this.connectorCreatedAt[fromId] = Date.now();
        peerConnector.SendStream(this.OnNeedLocalStream());
    }

    // Tears down a connector on purpose; its OnClose is ignored because it's no longer the current one
    private DestroyConnector(fromId: string): void {
        const peerConnector = this.connectors[fromId];
        if (peerConnector == null) {
            return;
        }

        delete this.connectors[fromId];
        delete this.connectorCreatedAt[fromId];
        peerConnector.Destroy();
        this.OnStreamEnded(fromId);
    }

    private ProcessClose(fromId: string, peerConnector: IPeerConnector) {
        if (this.connectors[fromId] !== peerConnector) {
            // A connector we already replaced or destroyed
            return;
        }

        delete this.connectors[fromId];
        delete this.connectorCreatedAt[fromId];
        this.OnStreamEnded(fromId);
        this.ScheduleReconnect(fromId);
    };

    private ScheduleReconnect(fromId: string): void {
        const attempt = this.retryAttempts[fromId] ?? 0;
        if (this.departed.has(fromId) || attempt >= ConnectionManager.retryDelaysMs.length) {
            this.GiveUp(fromId);
            return;
        }

        this.retryAttempts[fromId] = attempt + 1;
        this.ClearRetryTimer(fromId);
        this.OnConnectionChanged(fromId, "reconnecting (" + (attempt + 1) + "/" + ConnectionManager.retryDelaysMs.length + ")", "connection");

        // Jitter so both sides don't retry in lockstep
        const delay = ConnectionManager.retryDelaysMs[attempt] * (0.75 + Math.random() * 0.5);
        this.retryTimers[fromId] = window.setTimeout(() => {
            delete this.retryTimers[fromId];
            if (this.connectors.hasOwnProperty(fromId)) {
                // The other side's reconnect got here first
                return;
            }

            // Sent before the connector exists, so it arrives ahead of any offer the new connector makes
            this.TrySend({}, "reconnect", fromId);
            this.CreateConnector(fromId);
        }, delay);
    }

    private ClearRetryTimer(fromId: string): void {
        if (this.retryTimers.hasOwnProperty(fromId)) {
            clearTimeout(this.retryTimers[fromId]);
            delete this.retryTimers[fromId];
        }
    }

    private ResetRetries(fromId: string): void {
        this.ClearRetryTimer(fromId);
        delete this.retryAttempts[fromId];
    }

    private GiveUp(fromId: string): void {
        this.ResetRetries(fromId);
        this.OnClose(fromId);
    }

    private ProcessReconnect(fromId: string): void {
        this.departed.delete(fromId);
        this.ClearRetryTimer(fromId);

        const existing = this.connectors[fromId];
        if (existing != null && this.ShouldOffer(fromId) && !existing.IsConnected &&
            Date.now() - this.connectorCreatedAt[fromId] < ConnectionManager.freshConnectorMs) {
            // Both sides retried at once. Our fresh connector's offer is already on its way, and the other
            // side (the non-offerer) replaces its connector when our reconnect arrives, so keep this one.
            return;
        }

        this.DestroyConnector(fromId);
        this.CreateConnector(fromId);
    }

    private ProcessLeave(fromId: string): void {
        this.departed.add(fromId);
        this.ResetRetries(fromId);
        this.DestroyConnector(fromId);
        this.OnClose(fromId);
    }

    private OnMessage(message: Envelope) {
        const fromId = message.FromId;
        if (fromId == this.sessionConfig.AttendeeId) {
            // Ignore self messages
            return;
        }

        switch (message.Type) {
            case "location":
                this.ProcessLocation(message);
                break;
            case "discover":
                this.departed.delete(fromId);
                this.ResetRetries(fromId);
                this.CreateConnector(fromId);
                this.TrySend({}, "acknowledge", fromId);
                break;
            case "acknowledge":
                this.departed.delete(fromId);
                this.ResetRetries(fromId);
                this.CreateConnector(fromId);
                break;
            case "reconnect":
                this.ProcessReconnect(fromId);
                break;
            case "leave":
                this.ProcessLeave(fromId);
                break;
            default:
                if (this.departed.has(fromId)) {
                    return;
                }
                // Only an offer may start a connector; stray answers/candidates from a dead connector are dropped
                if (message.Type === "offer") {
                    this.CreateConnector(fromId);
                }
                if (this.connectors.hasOwnProperty(fromId)) {
                    this.connectors[fromId].Signal(message.Data);
                }
                break;
        }
    }

    private ProcessLocation(message: Envelope) {
        let location: ClientLocation = new ClientLocation();
        location.CityName = message.Data["cityName"];
        location.CountryName = message.Data["countryName"];
        location.CountryCode = message.Data["countryCode"];
        location.ContinentName = message.Data["continentName"];
        location.SubdivisionName = message.Data["subdivisionName"];
        this.OnLocation(message.FromId, location);
    }
}
