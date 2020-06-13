import { IPeerConnector, PeerConnector } from "./PeerConnector";

export interface IPeerConnectorFactory {
    CreatePeerConnector(shouldOffer: boolean) : IPeerConnector;
}

export class PeerConnectorFactory implements IPeerConnectorFactory {
    public CreatePeerConnector(shouldOffer: boolean) : IPeerConnector {
        return new PeerConnector(shouldOffer);
    }
}