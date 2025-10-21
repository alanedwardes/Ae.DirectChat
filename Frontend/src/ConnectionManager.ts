import { IBroker, Envelope } from "./Broker";
import { IPeerConnector } from "./PeerConnector";
import { ISessionConfig } from "./SessionConfig";
import { IPeerConnectorFactory } from "./PeerConnectorFactory";

interface OnCloseDelegate {
    (clientId: string): void;
}

interface OnHasStreamDelegate {
    (fromId: string, stream: MediaStream): void;
}

interface OnNeedLocalStreamDelegate {
    (): MediaStream;
}

interface OnClientConnectionChangedDelegate {
    (clientId: string, change: string): void;
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

export class ConnectionManager {
    private readonly broker: IBroker;
    public OnHasStream: OnHasStreamDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnConnectionChanged: OnClientConnectionChangedDelegate;
    public OnLocation: OnClientLocationDelegate;
    public OnClose: OnCloseDelegate;

    private connectors: { [fromId: string]: IPeerConnector; } = {};
    private offerRole: { [fromId: string]: boolean } = {};
    private connectionTimers: { [fromId: string]: number } = {};
    private isConnected: { [fromId: string]: boolean } = {};
    private flipAttempted: { [fromId: string]: boolean } = {};
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

    private CreateConnector(fromId: string, shouldOfferOverride?: boolean): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        const shouldOffer: boolean = (shouldOfferOverride == null)
            ? fromId < this.sessionConfig.AttendeeId
            : shouldOfferOverride;

        const peerConnector = this.peerConnectorFactory.CreatePeerConnector(shouldOffer);
        this.offerRole[fromId] = shouldOffer;
        this.isConnected[fromId] = false;
        peerConnector.OnConnectionChanged = change => {
            if (change === 'connected') {
                this.isConnected[fromId] = true;
                if (this.connectionTimers[fromId]) {
                    window.clearTimeout(this.connectionTimers[fromId]);
                    delete this.connectionTimers[fromId];
                }
            }
            if (change.startsWith('error:') && !this.isConnected[fromId]) {
                this.TryScheduleFlip(fromId);
            }
            this.OnConnectionChanged(fromId, change);
        };
        peerConnector.OnClose = () => this.ProcessClose(fromId);
        peerConnector.OnHasStream = stream => this.OnHasStream(fromId, stream);
        peerConnector.OnSendMessage = (payload: any, type: string) => this.broker.Send(payload, type, fromId);
        peerConnector.SendStream(this.OnNeedLocalStream());
        this.connectors[fromId] = peerConnector;

        this.TryScheduleFlip(fromId);
    }

    private ProcessClose(fromId: string) {
        delete this.connectors[fromId];
        delete this.offerRole[fromId];
        delete this.isConnected[fromId];
        delete this.flipAttempted[fromId];
        if (this.connectionTimers[fromId]) {
            window.clearTimeout(this.connectionTimers[fromId]);
            delete this.connectionTimers[fromId];
        }
        this.OnClose(fromId);
    };

    private OnMessage(message: Envelope) {
        if (message.FromId == this.sessionConfig.AttendeeId) {
            // Ignore self messages
            return;
        }

        this.CreateConnector(message.FromId);

        switch (message.Type) {
            case 'location':
                this.ProcessLocation(message);
                break;
            case 'discover':
                this.broker.Send({}, 'acknowledge', message.FromId);
                break;
            case 'acknowledge':
                // no-op
                break;
            case 'roleFlipRequest':
                this.FlipRoles(message.FromId);
                break;
            default:
                this.connectors[message.FromId].Signal(message.Data);
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

    private TryScheduleFlip(fromId: string): void {
        const isLeader: boolean = this.sessionConfig.AttendeeId > fromId;
        if (!isLeader) {
            return;
        }
        if (this.flipAttempted[fromId]) {
            return;
        }
        if (this.connectionTimers[fromId]) {
            return;
        }
        this.connectionTimers[fromId] = window.setTimeout(() => {
            if (this.isConnected[fromId] || this.flipAttempted[fromId]) {
                return;
            }
            this.flipAttempted[fromId] = true;
            this.broker.Send({}, 'roleFlipRequest', fromId);
            this.FlipRoles(fromId);
        }, 10000);
    }

    private FlipRoles(fromId: string): void {
        const hadConnector = !!this.connectors[fromId];
        if (hadConnector) {
            this.connectors[fromId].Destroy();
            delete this.connectors[fromId];
        }
        if (this.connectionTimers[fromId]) {
            window.clearTimeout(this.connectionTimers[fromId]);
            delete this.connectionTimers[fromId];
        }
        this.isConnected[fromId] = false;
        const previousShouldOffer: boolean = (this.offerRole[fromId] != null)
            ? this.offerRole[fromId]
            : (fromId < this.sessionConfig.AttendeeId);
        const newShouldOffer: boolean = !previousShouldOffer;
        this.CreateConnector(fromId, newShouldOffer);
    }
}