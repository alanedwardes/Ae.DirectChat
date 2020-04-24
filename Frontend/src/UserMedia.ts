export interface IUserMedia {
    GetMediaStream(): Promise<MediaStream>;
    GetSettings(): UserMediaSettings;
    SetSettings(newSettings: UserMediaSettings): Promise<void>;
}

export class UserMediaSetting<T> {
    constructor(value: T, name: string, description: string, category: string, hidden: boolean) {
        this.Name = name;
        this.Description = description;
        this.Category = category;
        this.Hidden = hidden;
        this.Value = value;
    }

    public readonly Name : string;
    public readonly Description : string;
    public readonly Category: string;
    public readonly Hidden: boolean;
    public Feature: string = null;
    public Value: T;
}

export class UserMediaSettingsRange extends UserMediaSetting<number> {
    constructor(min: number, max: number, step: number, value: number, name: string, description: string, category: string, hidden: boolean) {
        super(value, name, description, category, hidden);
        this.Min = min;
        this.Max = max;
        this.Step = step;
        this.Feature = "range";
    }

    public readonly Min: number;
    public readonly Max: number;
    public readonly Step: number;
}

export class UserMediaSettings {
    public VideoEnabled: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Video", "Start sending your camera", "Video", false);

    public AudioEnabled: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(true, "Enable Audio", null, "Basic Audio", false);
    public AudioGain: UserMediaSettingsRange = new UserMediaSettingsRange(1, 20, 0.5, 1, "Local Gain Multiplier", "The amount of amplification to add to your microphone", "Basic Audio", false);
    public AudioLocalListen: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Local Listen", "Allow you to hear your own microphone, as the other attendees will hear it", "Advanced Audio", false);
    public AudioEchoCancellation: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Echo Cancellation", "If you're using speakers, this will stop the other attendees from hearing themselves", "Advanced Audio", false);
    public AudioAutoGainControl: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Auto Gain", "Enable automatic volume control", "Advanced Audio", false);
    public AudioNoiseSuppression: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Noise Suppression", "Try to filter out background sounds", "Advanced Audio", false);
    public AudioStereo: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Stereo (Firefox attendees only)", null, "Advanced Audio", false);

    public AudioCompressor: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Dynamics Compressor", "Lowers the volume of the loudest parts of the signal in order to help prevent clipping and distortion", "Advanced Audio", false);
    // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode/threshold
    public AudioCompressorThreshold: UserMediaSettingsRange = new UserMediaSettingsRange(-100, 0, 1, -24, "Compressor Threshold", "The decibel value above which the compression will start taking effect", "Advanced Audio", true);
    // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode/knee
    public AudioCompressorKnee: UserMediaSettingsRange = new UserMediaSettingsRange(0, 40, 1, 30, "Compressor Knee", "The decibel value representing the range above the threshold where the curve smoothly transitions to the compressed portion", "Advanced Audio", true);
    // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode/ratio
    public AudioCompressorRatio: UserMediaSettingsRange = new UserMediaSettingsRange(1, 20, 1, 12, "Compressor Ratio", "The amount of change, in dB, needed in the input for a 1 dB change in the output", "Advanced Audio", true);
    // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode/attack
    public AudioCompressorAttack: UserMediaSettingsRange = new UserMediaSettingsRange(0, 1, 0.001, 0.003, "Compressor Attack", "The amount of time, in seconds, required to reduce the gain by 10 dB", "Advanced Audio", true);
    // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode/release
    public AudioCompressorRelease: UserMediaSettingsRange = new UserMediaSettingsRange(0, 1, 0.001, 0.25, "Compressor Release", "The amount of time, in seconds, required to increase the gain by 10 dB", "Advanced Audio", true);
}

interface OnMediaStreamAvailable {
    (stream: MediaStream): void;
}

export class UserMedia implements IUserMedia {
    private audioContext: AudioContext;
    private gainNode: GainNode;
    private analyserNode: AnalyserNode;
    private compressorNode: DynamicsCompressorNode;
    private localListenElement: HTMLAudioElement;
    private currentStream: MediaStream;
    private inputAudioChannels: number;

    private currentSettings: UserMediaSettings = new UserMediaSettings();

    public OnMediaStreamAvailable: OnMediaStreamAvailable;

    public GetSettings(): UserMediaSettings {
        return JSON.parse(JSON.stringify(this.currentSettings));
    }

    public async SetSettings(newSettings: UserMediaSettings): Promise<void> {
        let shouldRefreshMediaAccess: boolean;
        let shouldRefreshLocalListen: boolean;

        if (this.currentSettings.AudioAutoGainControl.Value != newSettings.AudioAutoGainControl.Value) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioEchoCancellation.Value != newSettings.AudioEchoCancellation.Value) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioNoiseSuppression.Value != newSettings.AudioNoiseSuppression.Value) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.VideoEnabled.Value != newSettings.VideoEnabled.Value) {
            shouldRefreshMediaAccess = true;
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioLocalListen.Value != newSettings.AudioLocalListen.Value) {
            shouldRefreshLocalListen = true;
        }

        if (this.currentSettings.AudioStereo.Value != newSettings.AudioStereo.Value) {
            shouldRefreshLocalListen = true;
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioCompressor.Value != newSettings.AudioCompressor.Value) {
            shouldRefreshLocalListen = true;
            shouldRefreshMediaAccess = true;
        }

        // These are cheap so don't need to be switched on/off
        this.SetCompressionParameters(newSettings);
        this.SetGainParameters(newSettings);

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

        if (this.currentSettings.AudioLocalListen.Value) {
            this.localListenElement.srcObject = this.currentStream;
            this.localListenElement.play();
        }
        else {
            this.localListenElement.pause();
        }
    }

    public async GetMediaStream(): Promise<MediaStream> {
        const audioConstraints: MediaTrackConstraints = {};
        audioConstraints.noiseSuppression = this.currentSettings.AudioNoiseSuppression.Value;
        audioConstraints.echoCancellation = this.currentSettings.AudioEchoCancellation.Value;
        audioConstraints.autoGainControl = this.currentSettings.AudioAutoGainControl.Value;

        const videoWidthRange: ConstrainULongRange = {};
        videoWidthRange.ideal = 1280;
        const videoHeightRange: ConstrainULongRange = {};
        videoHeightRange.ideal = 720;

        const videoConstraints: MediaTrackConstraints = {};
        videoConstraints.width = videoWidthRange;
        videoConstraints.height = videoHeightRange;

        const constraints: MediaStreamConstraints = {};
        constraints.audio = audioConstraints;
        if (this.currentSettings.VideoEnabled.Value) {
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

    private SetGainParameters(newSettings: UserMediaSettings): void {
        if (!newSettings.AudioEnabled.Value) {
            this.gainNode.gain.value = 0;
            return;
        }

        // In Chrome and Firefox, if a user has multiple channels
        // the gain needs to be multiplied by each. For example,
        // with 2 channels, the overall volume maxes out at 50%.
        // I'm not sure whether this is a browser bug or expected.
        this.gainNode.gain.value = this.inputAudioChannels * newSettings.AudioGain.Value;
    }

    private SetCompressionParameters(newSettings: UserMediaSettings): void {
        this.compressorNode.threshold.value = newSettings.AudioCompressorThreshold.Value;
        this.compressorNode.knee.value = newSettings.AudioCompressorKnee.Value;
        this.compressorNode.ratio.value = newSettings.AudioCompressorRatio.Value;
        this.compressorNode.attack.value = newSettings.AudioCompressorAttack.Value;
        this.compressorNode.release.value = newSettings.AudioCompressorRelease.Value;
    }

    private ProcessAudioTrackToMono(stream: MediaStream): MediaStream {
        const source: MediaStreamAudioSourceNode = this.audioContext.createMediaStreamSource(stream);
        this.inputAudioChannels = source.channelCount;

        const destination: MediaStreamAudioDestinationNode = this.audioContext.createMediaStreamDestination();
        destination.channelCount = this.currentSettings.AudioStereo.Value ? 2 : 1;

        this.gainNode = this.audioContext.createGain();
        this.compressorNode = this.audioContext.createDynamicsCompressor();

        this.SetGainParameters(this.currentSettings);
        this.SetCompressionParameters(this.currentSettings);

        source.connect(this.gainNode);

        let lastNode: AudioNode = this.gainNode;
        if (this.currentSettings.AudioCompressor.Value) {
            lastNode.connect(this.compressorNode);
            lastNode = this.compressorNode;
        }

        this.analyserNode = this.audioContext.createAnalyser();

        lastNode.connect(this.analyserNode);
        lastNode.connect(destination);

        return destination.stream;
    }
}