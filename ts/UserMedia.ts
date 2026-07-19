export interface IUserMedia {
    GetMediaStream(): Promise<MediaStream>;
    GetSettings(): UserMediaSettings;
    SetSettings(newSettings: UserMediaSettings): Promise<void>;
    SampleInputTimeDomain(): Float32Array;
    SampleOutputTimeDomain(): Float32Array;
    SampleInputFrequency(): Uint8Array;
    SampleOutputFrequency(): Uint8Array;
    AddRemoteStream(tag: string, mediaStream: MediaStream): void;
    RemoveRemoteStream(tag: string): void;
    OnMediaStreamAvailable: OnMediaStreamAvailable;
}

export enum UserMediaSettingType {
    Generic,
    Range,
    Select
}

export interface IUserMediaSetting {
    readonly Name: string;
    readonly Description: string;
    readonly Category: string;
    readonly Hidden: boolean;
    readonly Type: UserMediaSettingType;
    readonly Value: any;
}

export class UserMediaSetting<T> implements IUserMediaSetting {
    constructor(value: T, name: string, description: string, category: string, hidden: boolean) {
        this.Name = name;
        this.Description = description;
        this.Category = category;
        this.Hidden = hidden;
        this.Value = value;
    }

    public readonly Name: string;
    public readonly Description: string;
    public readonly Category: string;
    public readonly Hidden: boolean;
    public Type: UserMediaSettingType = UserMediaSettingType.Generic;
    public Value: T;
}

export class UserMediaSettingsRange extends UserMediaSetting<number> {
    constructor(min: number, max: number, step: number, value: number, name: string, description: string, category: string, hidden: boolean) {
        super(value, name, description, category, hidden);
        this.Min = min;
        this.Max = max;
        this.Step = step;
        this.Type = UserMediaSettingType.Range;
    }

    public readonly Min: number;
    public readonly Max: number;
    public readonly Step: number;
}

export class UserSettingsSelection<T> extends UserMediaSetting<T> {
    constructor(value: T, options: T[], name: string, description: string, category: string, hidden: boolean) {
        super(value, name, description, category, hidden);
        this.Options = options;
        this.Type = UserMediaSettingType.Select;
    }

    public readonly Options: T[] = [];
}

export interface IUserMediaSettings {
    [key: string]: any;

    ScreenEnabled: UserMediaSetting<boolean>;

    VideoEnabled: UserMediaSetting<boolean>;
    VideoResolution: UserSettingsSelection<string>;
    VideoFrameRate: UserMediaSettingsRange;

    AudioEnabled: UserMediaSetting<boolean>;
    AudioLocalMeter: UserMediaSetting<boolean>;
    AudioGain: UserMediaSettingsRange;
    AudioLocalListen: UserMediaSettingsRange;
    AudioEchoCancellation: UserMediaSetting<boolean>;
    AudioAutoGainControl: UserMediaSetting<boolean>;
    AudioNoiseSuppression: UserMediaSetting<boolean>;
    AudioStereo: UserMediaSetting<boolean>;

    AudioCompressor: UserMediaSetting<boolean>;
    AudioCompressorThreshold: UserMediaSettingsRange;
    AudioCompressorKnee: UserMediaSettingsRange;
    AudioCompressorRatio: UserMediaSettingsRange;
    AudioCompressorAttack: UserMediaSettingsRange;
    AudioCompressorRelease: UserMediaSettingsRange;
}

class UserMediaSettings implements IUserMediaSettings {
    public ScreenEnabled: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Screen", "Start sharing your screen", "Basic Screen", false);

    public VideoEnabled: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(false, "Enable Video", "Start sending your camera", "Basic Video", false);
    public VideoResolution: UserSettingsSelection<string> = new UserSettingsSelection<string>("720p", ["480p", "720p", "1080p"], "Resolution", "Sets the ideal resolution for your camera. Your web browser might choose to ignore this.", "Advanced Video", false);
    public VideoFrameRate: UserMediaSettingsRange = new UserMediaSettingsRange(15, 60, 5, 20, "Frame Rate", "Sets the ideal frame rate for your camera. Your web browser might choose to ignore this.", "Advanced Video", false);

    public AudioEnabled: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(true, "Enable Audio", null, "Basic Audio", false);
    public AudioLocalMeter: UserMediaSetting<boolean> = new UserMediaSetting<boolean>(true, "Enable Audio Meter", null, "Basic Audio", false);
    public AudioGain: UserMediaSettingsRange = new UserMediaSettingsRange(0.5, 5, 0.5, 1, "Input Gain", "The amount of amplification to add to your microphone", "Basic Audio", false);
    public AudioLocalListen: UserMediaSettingsRange = new UserMediaSettingsRange(0, 1, 0.05, 0, "Self Listen Volume", "Allow you to hear your own microphone, as the other attendees will hear it", "Advanced Audio", false);
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
    private remoteStreams: { [tag: string]: MediaStreamAudioSourceNode; } = {};
    private audioContext: AudioContext;
    private inputGainNode: GainNode;
    private inputAnalyserNode: AnalyserNode;
    private inputCompressorNode: DynamicsCompressorNode;
    private inputStreamAudioNode: AudioNode;
    private inputAudioChannels: number;

    private outputAnalyserNode: AnalyserNode;

    private currentSettings: IUserMediaSettings = new UserMediaSettings();

    public OnMediaStreamAvailable: OnMediaStreamAvailable;
    public inputStreamMonitorAudioNode: GainNode;

    public GetSettings(): IUserMediaSettings {
        return JSON.parse(JSON.stringify(this.currentSettings));
    }

    public async SetSettings(newSettings: IUserMediaSettings): Promise<void> {
        let shouldRefreshMediaAccess: boolean;

        if (this.currentSettings.ScreenEnabled.Value !== newSettings.ScreenEnabled.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioAutoGainControl.Value !== newSettings.AudioAutoGainControl.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioEchoCancellation.Value !== newSettings.AudioEchoCancellation.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioNoiseSuppression.Value !== newSettings.AudioNoiseSuppression.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioLocalMeter.Value !== newSettings.AudioLocalMeter.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.VideoEnabled.Value !== newSettings.VideoEnabled.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.VideoResolution.Value !== newSettings.VideoResolution.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.VideoFrameRate.Value !== newSettings.VideoFrameRate.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioStereo.Value !== newSettings.AudioStereo.Value) {
            shouldRefreshMediaAccess = true;
        }

        if (this.currentSettings.AudioCompressor.Value !== newSettings.AudioCompressor.Value) {
            shouldRefreshMediaAccess = true;
        }

        // These are cheap so don't need to be switched on/off
        this.SetCompressionParameters(newSettings);
        this.SetGainParameters(newSettings);

        this.currentSettings = newSettings;

        // If we should refresh media access, and there is currently a stream to refresh
        if (shouldRefreshMediaAccess) {
            await this.GetMediaStream();
        }
    }

    private GetAudioContext(): AudioContext {
        const windowDictionary = window as { [key: string]: any };

        // Fall back to webkit audio context
        let audioContext = windowDictionary['AudioContext'] || windowDictionary['webkitAudioContext'];

        // Lazy initialise the audio context
        if (this.audioContext == null) {
            this.audioContext = new audioContext();
        }

        return this.audioContext;
    }

    public AddRemoteStream(tag: string, mediaStream: MediaStream): void {
        if (this.outputAnalyserNode == null) {
            this.outputAnalyserNode = this.GetAudioContext().createAnalyser();
            this.outputAnalyserNode.connect(this.GetAudioContext().destination);
        }

        if (mediaStream.getAudioTracks().length === 0) {
            console.error("Ignoring remote stream with zero audio tracks");
            return;
        }

        this.RemoveRemoteStream(tag);
        console.log("Got media stream", mediaStream);
        this.remoteStreams[tag] = this.GetAudioContext().createMediaStreamSource(mediaStream);
        this.remoteStreams[tag].connect(this.outputAnalyserNode);
    }

    public RemoveRemoteStream(tag: string): void {
        if (this.remoteStreams.hasOwnProperty(tag)) {
            this.remoteStreams[tag].disconnect(this.outputAnalyserNode);
            delete this.remoteStreams[tag];
        }
    }

    public async GetMediaStream(): Promise<MediaStream> {
        const audioConstraints: MediaTrackConstraints = {};
        audioConstraints.noiseSuppression = this.currentSettings.AudioNoiseSuppression.Value;
        audioConstraints.echoCancellation = this.currentSettings.AudioEchoCancellation.Value;
        audioConstraints.autoGainControl = this.currentSettings.AudioAutoGainControl.Value;

        const videoResolutions: { [fromId: string]: number[]; } = {
            '480p': [854, 480],
            '720p': [1280, 720],
            '1080p': [1920, 1080]
        };

        const videoWidthRange: ConstrainULongRange = {};
        videoWidthRange.ideal = videoResolutions[this.currentSettings.VideoResolution.Value][0];

        const videoHeightRange: ConstrainULongRange = {};
        videoHeightRange.ideal = videoResolutions[this.currentSettings.VideoResolution.Value][1];

        const videoFrameRate: ConstrainDouble = {};
        videoFrameRate.ideal = this.currentSettings.VideoFrameRate.Value;

        const videoConstraints: MediaTrackConstraints = {};
        videoConstraints.width = videoWidthRange;
        videoConstraints.height = videoHeightRange;
        videoConstraints.frameRate = videoFrameRate;

        const constraints: MediaStreamConstraints = {};
        constraints.audio = audioConstraints;
        if (this.currentSettings.VideoEnabled.Value) {
            constraints.video = videoConstraints;
        }

        const stream: MediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        const audioTracks: MediaStreamTrack[] = stream.getAudioTracks();
        console.assert(audioTracks.length == 1, "Expected 1 audio track, there are " + audioTracks.length);

        let videoTracks: MediaStreamTrack[];
        if (this.currentSettings.ScreenEnabled.Value) {
            // @ts-ignore
            const screenStream: MediaStream = await navigator.mediaDevices.getDisplayMedia();
            videoTracks = screenStream.getVideoTracks();
        } else {
            videoTracks = stream.getVideoTracks();
        }

        console.assert(videoTracks.length <= 1, "Expected 1 or 0 video tracks, there are " + videoTracks.length);

        this.inputStreamAudioNode = this.ProcessAudioTrackToMono(stream);

        if (this.inputStreamMonitorAudioNode != null) {
            this.inputStreamMonitorAudioNode.disconnect();
        }

        this.inputStreamMonitorAudioNode = this.GetAudioContext().createGain();
        this.inputStreamMonitorAudioNode.gain.value = this.currentSettings.AudioLocalListen.Value;
        this.inputStreamMonitorAudioNode.connect(this.GetAudioContext().destination);

        this.inputStreamAudioNode.connect(this.inputStreamMonitorAudioNode);

        let inputStreamNode = this.GetAudioContext().createMediaStreamDestination();
        this.inputStreamAudioNode.connect(inputStreamNode);

        let inputStream = inputStreamNode.stream;
        if (videoTracks.length > 0) {
            inputStream.addTrack(videoTracks[0]);
        }

        if (this.OnMediaStreamAvailable != null) {
            this.OnMediaStreamAvailable(inputStream);
        }

        return inputStream;
    }

    private static GetTimeDomainDataFromAnalyser(analyserNode: AnalyserNode): Float32Array {
        if (analyserNode == null) {
            return new Float32Array(0);
        }

        const sampleBuffer = new Float32Array(analyserNode.fftSize);
        analyserNode.getFloatTimeDomainData(sampleBuffer);
        return sampleBuffer;
    }

    private static GetFrequencyDataFromAnalyser(analyserNode: AnalyserNode): Uint8Array {
        if (analyserNode == null) {
            return new Uint8Array(0);
        }

        const sampleBuffer = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(sampleBuffer);
        return sampleBuffer;
    }

    public SampleInputTimeDomain(): Float32Array {
        return UserMedia.GetTimeDomainDataFromAnalyser(this.inputAnalyserNode);
    }

    public SampleOutputTimeDomain(): Float32Array {
        return UserMedia.GetTimeDomainDataFromAnalyser(this.outputAnalyserNode);
    }

    public SampleInputFrequency(): Uint8Array {
        return UserMedia.GetFrequencyDataFromAnalyser(this.inputAnalyserNode);
    }
    public SampleOutputFrequency(): Uint8Array {
        return UserMedia.GetFrequencyDataFromAnalyser(this.outputAnalyserNode);
    }

    private SetGainParameters(newSettings: UserMediaSettings): void {
        if (this.inputGainNode == null) {
            return;
        }

        if (!newSettings.AudioEnabled.Value) {
            this.inputGainNode.gain.value = 0;
            return;
        }

        // In Chrome and Firefox, if a user has multiple channels
        // the gain needs to be multiplied by each. For example,
        // with 2 channels, the overall volume maxes out at 50%.
        // I'm not sure whether this is a browser bug or expected.
        this.inputGainNode.gain.value = this.inputAudioChannels * newSettings.AudioGain.Value;

        if (this.inputStreamMonitorAudioNode != null) {
            this.inputStreamMonitorAudioNode.gain.value = newSettings.AudioLocalListen.Value;
        }
    }

    private SetCompressionParameters(newSettings: UserMediaSettings): void {
        if (this.inputCompressorNode == null) {
            return;
        }

        this.inputCompressorNode.threshold.value = newSettings.AudioCompressorThreshold.Value;
        this.inputCompressorNode.knee.value = newSettings.AudioCompressorKnee.Value;
        this.inputCompressorNode.ratio.value = newSettings.AudioCompressorRatio.Value;
        this.inputCompressorNode.attack.value = newSettings.AudioCompressorAttack.Value;
        this.inputCompressorNode.release.value = newSettings.AudioCompressorRelease.Value;
    }

    private ProcessAudioTrackToMono(stream: MediaStream): AudioNode {
        const source: MediaStreamAudioSourceNode = this.GetAudioContext().createMediaStreamSource(stream);
        this.inputAudioChannels = source.channelCount;

        this.inputGainNode = this.GetAudioContext().createGain();
        this.inputGainNode.channelCount = this.currentSettings.AudioStereo.Value ? 2 : 1;
        this.inputGainNode.channelCountMode = "explicit";
        this.SetGainParameters(this.currentSettings);

        source.connect(this.inputGainNode);

        let lastNode: AudioNode = this.inputGainNode;

        if (this.currentSettings.AudioCompressor.Value) {
            this.inputCompressorNode = this.GetAudioContext().createDynamicsCompressor();
            this.SetCompressionParameters(this.currentSettings);
            lastNode.connect(this.inputCompressorNode);
            lastNode = this.inputCompressorNode;
        }
        else {
            this.inputCompressorNode = null;
        }

        this.inputAnalyserNode = this.GetAudioContext().createAnalyser();
        lastNode.connect(this.inputAnalyserNode);
        return this.inputAnalyserNode;
    }
}