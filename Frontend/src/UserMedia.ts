export interface IUserMedia {
    GetMediaStream(): Promise<MediaStream>;
    GetSettings(): UserMediaSettings;
    SetSettings(newSettings: UserMediaSettings): Promise<void>;
}

export class UserMediaSettings {
    public VideoEnabled: boolean = false;
    public AudioEchoCancellation: boolean = false;
    public AudioAutoGainControl: boolean = false;
    public AudioNoiseSuppression: boolean = false;
    public AudioLocalListen: boolean = false;
    public AudioStereo: boolean = false;
    public AudioGain: number = 1;
}

interface OnMediaStreamAvailable {
    (stream: MediaStream): void;
}

export class UserMedia implements IUserMedia {
    private audioContext: AudioContext;
    private gainNode: GainNode;
    private analyserNode: AnalyserNode;
    private localListenElement: HTMLAudioElement;
    private currentStream: MediaStream;
    private inputAudioChannels: number;

    private currentSettings: UserMediaSettings = new UserMediaSettings();

    public OnMediaStreamAvailable: OnMediaStreamAvailable;

    public GetSettings(): UserMediaSettings {
        let settingsCopy = new UserMediaSettings();
        Object.assign(settingsCopy, this.currentSettings);
        return settingsCopy;
    }

    public async SetSettings(newSettings: UserMediaSettings): Promise<void> {
        let shouldRefreshMediaAccess: boolean;
        let shouldRefreshLocalListen: boolean;

        if (this.currentSettings.AudioGain != newSettings.AudioGain) {
            this.SetGain(newSettings.AudioGain);
        }

        if (this.currentSettings.AudioAutoGainControl != newSettings.AudioAutoGainControl) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioEchoCancellation != newSettings.AudioEchoCancellation) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioNoiseSuppression != newSettings.AudioNoiseSuppression) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.VideoEnabled != newSettings.VideoEnabled) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioLocalListen != newSettings.AudioLocalListen) {
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioStereo != newSettings.AudioStereo) {
            shouldRefreshLocalListen = true;
            shouldRefreshMediaAccess = true;
        }

        this.currentSettings = newSettings;

        if (shouldRefreshMediaAccess) {
            await this.GetMediaStream();
        }

        if (shouldRefreshLocalListen) {
            this.EvaluateLocalListen();
        }
    }

    private EvaluateLocalListen(): void {
        if (this.localListenElement == null) {
            this.localListenElement = document.createElement("audio");
        }

        if (this.currentSettings.AudioLocalListen) {
            this.localListenElement.srcObject = this.currentStream;
            this.localListenElement.play();
        }
        else {
            this.localListenElement.pause();
        }
    }

    public async GetMediaStream(): Promise<MediaStream> {
        const audioConstraints: MediaTrackConstraints = {};
        audioConstraints.noiseSuppression = this.currentSettings.AudioNoiseSuppression;
        audioConstraints.echoCancellation = this.currentSettings.AudioEchoCancellation;
        audioConstraints.autoGainControl = this.currentSettings.AudioAutoGainControl;

        const videoWidthRange: ConstrainULongRange = {};
        videoWidthRange.ideal = 1280;
        const videoHeightRange: ConstrainULongRange = {};
        videoHeightRange.ideal = 720;

        const videoConstraints: MediaTrackConstraints = {};
        videoConstraints.width = videoWidthRange;
        videoConstraints.height = videoHeightRange;

        const constraints: MediaStreamConstraints = {};
        constraints.audio = audioConstraints;
        if (this.currentSettings.VideoEnabled) {
            constraints.video = videoConstraints;
        }

        const stream: MediaStream = await navigator.mediaDevices.getUserMedia(constraints);

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

        if (this.OnMediaStreamAvailable != null) {
            this.OnMediaStreamAvailable(this.currentStream);
        }

        return this.currentStream;
    }

    public SampleInput(): number {
        if (this.analyserNode == null) {
            return 0;
        }

        const sampleBuffer = new Float32Array(this.analyserNode.fftSize);

        this.analyserNode.getFloatTimeDomainData(sampleBuffer);

        var peak = 0;
        sampleBuffer.forEach(function (value) {
            peak = Math.max(peak, Math.abs(value));
        });
        return peak;
    }

    private SetGain(newGain: number) : void {
        // In Chrome and Firefox, if a user has multiple channels
        // the gain needs to be multiplied by each. For example,
        // with 2 channels, the overall volume maxes out at 50%.
        // I'm not sure whether this is a browser bug or expected.
        this.gainNode.gain.value = this.inputAudioChannels * newGain;
    }

    private ProcessAudioTrackToMono(stream: MediaStream): MediaStream {
        const source: MediaStreamAudioSourceNode = this.audioContext.createMediaStreamSource(stream);
        this.inputAudioChannels = source.channelCount;

        const destination: MediaStreamAudioDestinationNode = this.audioContext.createMediaStreamDestination();
        destination.channelCount = this.currentSettings.AudioStereo ? 2 : 1;

        this.gainNode = this.audioContext.createGain();
        this.SetGain(this.currentSettings.AudioGain);

        source.connect(this.gainNode);

        this.analyserNode = this.audioContext.createAnalyser();

        this.gainNode.connect(this.analyserNode);

        this.gainNode.connect(destination);

        return destination.stream;
    }
}