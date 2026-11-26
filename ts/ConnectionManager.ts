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

// One connector to a client, plus the IDs used to tell its signals apart from those of earlier connectors
interface Peer {
    connector: IPeerConnector;
    // Sent as connectionFrom on every signal this connector makes
    localId: string;
    // The other side's connector we're paired with; null until we hear from it
    remoteId: string;
    // Made by our own retry timer (as opposed to in answer to the other side)
    byOwnRetry: boolean;
}

// Reconnection protocol (both messages are relayed peer-to-peer by the signalling server):
//  - "reconnect" { connectionId }: the sender has thrown away its connector and made a fresh one with this ID;
//    the receiver should do the same and pair with it.
//  - "leave": the sender is closing the page; the receiver should forget it without retrying.
// Every signal carries connectionFrom/connectionTo, so signals left over from a replaced connector are dropped
// instead of being fed to (and breaking) its replacement. PeerConnector ignores the extra fields, so clients
// running older code still understand the signals.
export class ConnectionManager {
    private static readonly retryDelaysMs: number[] = [1000, 3000, 10000, 20000];

    private readonly broker: IBroker;
    public OnHasStream: OnHasStreamDelegate;
    public OnStreamEnded: OnStreamEndedDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnConnectionChanged: OnClientConnectionChangedDelegate;
    public OnLocation: OnClientLocationDelegate;
    // Fired once a client has gone for good (left, or every reconnect attempt failed)
    public OnClose: OnCloseDelegate;

    private peers: { [fromId: string]: Peer; } = {};
    private retryAttempts: { [fromId: string]: number; } = {};
    private retryTimers: { [fromId: string]: number; } = {};
    // Clients that left or that we gave up on. Their reconnects and signals are ignored until they
    // discover/acknowledge again (i.e. rejoin), so two peers that can never connect don't retry forever.
    private readonly gone: Set<string> = new Set<string>();
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

        for (let clientId in this.peers) {
            if (this.peers.hasOwnProperty(clientId)) {
                this.peers[clientId].connector.SendStream(localStream);
            }
        }
    }

    // Tell every peer we're going, so they remove us immediately instead of retrying
    public Leave(): void {
        const clientIds = new Set<string>([...Object.keys(this.peers), ...Object.keys(this.retryTimers)]);
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

    private CreateConnector(fromId: string, localId: string = crypto.randomUUID(), remoteId: string = null, byOwnRetry: boolean = false): void {
        if (this.peers.hasOwnProperty(fromId)) {
            return;
        }

        const peerConnector = this.peerConnectorFactory.CreatePeerConnector(this.ShouldOffer(fromId));
        const peer: Peer = { connector: peerConnector, localId: localId, remoteId: remoteId, byOwnRetry: byOwnRetry };
        peerConnector.OnConnectionChanged = (change, category) => this.OnConnectionChanged(fromId, change, category);
        peerConnector.OnConnect = () => delete this.retryAttempts[fromId];
        peerConnector.OnClose = () => this.ProcessClose(fromId, peerConnector);
        peerConnector.OnHasStream = stream => this.OnHasStream(fromId, stream);
        peerConnector.OnSendMessage = (payload: any, type: string) => this.TrySend(
            { ...payload, connectionFrom: peer.localId, connectionTo: peer.remoteId }, type, fromId);
        this.peers[fromId] = peer;
        peerConnector.SendStream(this.OnNeedLocalStream());
    }

    // Tears down a connector on purpose; its OnClose is ignored because it's no longer the current one
    private DestroyConnector(fromId: string): void {
        const peer = this.peers[fromId];
        if (peer == null) {
            return;
        }

        delete this.peers[fromId];
        peer.connector.Destroy();
        this.OnStreamEnded(fromId);
    }

    private ProcessClose(fromId: string, peerConnector: IPeerConnector) {
        const peer = this.peers[fromId];
        if (peer == null || peer.connector !== peerConnector) {
            // A connector we already replaced or destroyed
            return;
        }

        delete this.peers[fromId];
        this.OnStreamEnded(fromId);
        this.ScheduleReconnect(fromId);
    };

    private ScheduleReconnect(fromId: string): void {
        const attempt = this.retryAttempts[fromId] ?? 0;
        if (this.gone.has(fromId) || attempt >= ConnectionManager.retryDelaysMs.length) {
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
            if (this.peers.hasOwnProperty(fromId)) {
                // The other side's reconnect got here first
                return;
            }

            // Sent before the connector exists, so it arrives ahead of any offer the new connector makes
            const localId = crypto.randomUUID();
            this.TrySend({ connectionId: localId }, "reconnect", fromId);
            this.CreateConnector(fromId, localId, null, true);
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
        this.gone.add(fromId);
        this.ResetRetries(fromId);
        this.OnClose(fromId);
    }

    // A client that's (re)joining the room: start afresh with it
    private ProcessJoin(fromId: string): void {
        this.gone.delete(fromId);
        this.ResetRetries(fromId);
        this.CreateConnector(fromId);
    }

    private ProcessReconnect(fromId: string, connectionId: string): void {
        if (this.gone.has(fromId)) {
            return;
        }

        this.ClearRetryTimer(fromId);

        const existing = this.peers[fromId];
        if (existing != null && existing.byOwnRetry && existing.remoteId == null && this.ShouldOffer(fromId)) {
            // Both sides retried at once and our reconnect crossed theirs. Ours reaches them before our offer
            // does, and they (the non-offerer) always replace their connector on a reconnect, so they'll pair
            // with this one: keep it rather than starting over.
            return;
        }

        this.DestroyConnector(fromId);
        this.CreateConnector(fromId, crypto.randomUUID(), connectionId ?? null);
    }

    private ProcessLeave(fromId: string): void {
        this.gone.add(fromId);
        this.ResetRetries(fromId);
        this.DestroyConnector(fromId);
        this.OnClose(fromId);
    }

    private ProcessSignal(fromId: string, data: any): void {
        if (this.gone.has(fromId) || data == null || typeof data !== "object") {
            return;
        }

        const { connectionFrom, connectionTo, ...signal } = data;
        const isOffer = signal.type === "offer";
        let peer = this.peers[fromId];

        if (connectionFrom === undefined) {
            // From a client running older code, which doesn't send connection IDs
            if (peer == null && isOffer) {
                this.CreateConnector(fromId);
                peer = this.peers[fromId];
            }
            if (peer != null) {
                peer.connector.Signal(signal);
            }
            return;
        }

        if (peer != null && connectionTo != null && connectionTo !== peer.localId) {
            // Meant for one of our earlier connectors
            return;
        }

        if (peer != null && peer.remoteId != null && connectionFrom !== peer.remoteId) {
            if (!isOffer || connectionTo != null) {
                // From one of their earlier connectors
                return;
            }
            // A first offer from a connector we haven't heard of: they've started again, so follow
            this.DestroyConnector(fromId);
            peer = null;
        }

        if (peer == null) {
            if (!isOffer) {
                // Only an offer may start a connector
                return;
            }
            this.CreateConnector(fromId, crypto.randomUUID(), connectionFrom);
            peer = this.peers[fromId];
        }

        if (peer.remoteId == null) {
            peer.remoteId = connectionFrom;
        }

        peer.connector.Signal(signal);
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
                this.ProcessJoin(fromId);
                this.TrySend({}, "acknowledge", fromId);
                break;
            case "acknowledge":
                this.ProcessJoin(fromId);
                break;
            case "reconnect":
                this.ProcessReconnect(fromId, message.Data?.connectionId);
                break;
            case "leave":
                this.ProcessLeave(fromId);
                break;
            default:
                this.ProcessSignal(fromId, message.Data);
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
