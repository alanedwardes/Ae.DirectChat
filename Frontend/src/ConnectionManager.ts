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

export class ConnectionManager {
    private readonly broker: IBroker;
    public OnHasStream: OnHasStreamDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnConnectionChanged: OnClientConnectionChangedDelegate;
    public OnLocation: OnClientLocationDelegate;
    public OnClose: OnCloseDelegate;

    private connectors: { [fromId: string]: IPeerConnector; } = {};
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

    private CreateConnector(fromId: string): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        const shouldOffer: boolean = fromId < this.sessionConfig.AttendeeId;

        const peerConnector = this.peerConnectorFactory.CreatePeerConnector(shouldOffer);
        peerConnector.OnConnectionChanged = (change, category) => this.OnConnectionChanged(fromId, change, category);
        peerConnector.OnClose = () => this.ProcessClose(fromId);
        peerConnector.OnHasStream = stream => this.OnHasStream(fromId, stream);
        peerConnector.OnSendMessage = (payload: any, type: string) => this.broker.Send(payload, type, fromId);
        peerConnector.SendStream(this.OnNeedLocalStream());
        this.connectors[fromId] = peerConnector;
    }

    private ProcessClose(fromId: string) {
        delete this.connectors[fromId];
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
}