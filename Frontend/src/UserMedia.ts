export interface IUserMedia {
    RequestAccess(video : boolean): Promise<MediaStream>;
}

export class UserMedia implements IUserMedia {
    private audioContext: AudioContext;
    private gainNode: GainNode;
    private analyserNode: AnalyserNode;
    private localListenElement: HTMLAudioElement;
    private currentStream: MediaStream;

    public async RequestAccess(video : boolean): Promise<MediaStream> {
        const stream: MediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
            },
            video: video
        });

        // Lazy initialise the audio context
        if (this.audioContext == null) {
            this.audioContext = new AudioContext();
        }

        const audioTracks: MediaStreamTrack[] = stream.getAudioTracks();
        console.assert(audioTracks.length == 1, "Expected 1 audio track, there are " + audioTracks.length);

        const videoTracks: MediaStreamTrack[] = stream.getVideoTracks();
        console.assert(videoTracks.length <= 1, "Expected 1 or 0 video tracks, there are " + videoTracks.length);

        var combined = this.ProcessAudioTrackToMono(stream);

        if (videoTracks.length > 0) {
            combined.addTrack(videoTracks[0]);
        }

        this.currentStream = combined;
        return combined;
    }

    public SetLocalListen(shouldListen: boolean) {
        if (this.localListenElement == null){
            this.localListenElement = document.createElement("audio");
        }

        if (shouldListen) {
            this.localListenElement.srcObject = this.currentStream;
            this.localListenElement.play();
        }
        else {
            this.localListenElement.pause();
        }
    }

    public GetGain(): number {
        if (this.gainNode == null) {
            return 0;
        }

        return this.gainNode.gain.value;
    }

    public SetGain(gain: number): void {
        this.gainNode.gain.value = gain;
    }

    public SampleInput(): number {
        const sampleBuffer = new Float32Array(this.analyserNode.fftSize);

        this.analyserNode.getFloatTimeDomainData(sampleBuffer);

        var peak = 0;
        sampleBuffer.forEach(function (value) {
            peak = Math.max(peak, Math.abs(value));
        });
        return peak;
    }

    private ProcessAudioTrackToMono(stream: MediaStream): MediaStream {
        const source: MediaStreamAudioSourceNode = this.audioContext.createMediaStreamSource(stream);

        const destination: MediaStreamAudioDestinationNode = this.audioContext.createMediaStreamDestination();
        destination.channelCount = 1;

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;

        source.connect(this.gainNode);

        this.analyserNode = this.audioContext.createAnalyser();

        this.gainNode.connect(this.analyserNode);

        this.gainNode.connect(destination);

        return destination.stream;
    }
}