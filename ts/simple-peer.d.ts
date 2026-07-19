declare namespace SimplePeer {
    interface Options {
        initiator?: boolean;
    }

    interface SignalData {
        type: string;
        sdp?: string;
        candidate?: unknown;
        [key: string]: unknown;
    }

    interface Instance {
        on(event: "signal", listener: (data: SignalData) => void): void;
        on(event: "connect", listener: () => void): void;
        on(event: "stream", listener: (stream: MediaStream) => void): void;
        on(event: "error", listener: (error: Error) => void): void;
        on(event: "close", listener: () => void): void;
        signal(data: SignalData): void;
        addTrack(track: MediaStreamTrack, stream: MediaStream): void;
        removeTrack(track: MediaStreamTrack, stream: MediaStream): void;
        removeAllListeners(): void;
        destroy(): void;
    }
}

declare const SimplePeer: {
    new(options?: SimplePeer.Options): SimplePeer.Instance;
};
