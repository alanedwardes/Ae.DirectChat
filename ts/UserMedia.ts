export interface IUserMedia {
    GetMediaStream(): Promise<MediaStream>;
    RefreshMediaStream(): Promise<MediaStream>;
    GetSettings(): UserMediaSettings;
    UpdateSettings(changes: SettingChanges): Promise<void>;
    RestoreSettings(changes: SettingChanges): void;
    SampleInputTimeDomain(): Float32Array;
    SampleOutputTimeDomain(): Float32Array;
    SampleInputFrequency(): Uint8Array;
    SampleOutputFrequency(): Uint8Array;
    AddRemoteStream(tag: string, mediaStream: MediaStream): void;
    RemoveRemoteStream(tag: string): void;
    ResumeAudio(): Promise<void>;
    readonly IsAudioBlocked: boolean;
    OnMediaStreamAvailable: OnMediaStreamAvailable;
    OnSettingsChanged: OnSettingsChanged;
    OnAudioStateChanged: (blocked: boolean) => void;
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

// Setting key to its new value, e.g. { ScreenEnabled: false }
export interface SettingChanges {
    [key: string]: any;
}

interface OnSettingsChanged {
    (settings: IUserMediaSettings): void;
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

    private inputTracks: MediaStreamTrack[] = [];
    private inputNodes: AudioNode[] = [];

    private readonly timeDomainBuffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
    private readonly frequencyBuffers = new WeakMap<AnalyserNode, Uint8Array<ArrayBuffer>>();
    private static readonly emptyTimeDomainBuffer: Float32Array<ArrayBuffer> = new Float32Array(0);
    private static readonly emptyFrequencyBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);

    private currentSettings: IUserMediaSettings = new UserMediaSettings();

    public OnMediaStreamAvailable: OnMediaStreamAvailable;
    public OnSettingsChanged: OnSettingsChanged;
    public OnAudioStateChanged: (blocked: boolean) => void;
    public inputStreamMonitorAudioNode: GainNode;

    // Settings that need the media streams to be re-acquired when they change
    private static readonly refreshSettingKeys: string[] = [
        "ScreenEnabled",
        "AudioAutoGainControl",
        "AudioEchoCancellation",
        "AudioNoiseSuppression",
        "VideoEnabled",
        "VideoResolution",
        "VideoFrameRate",
        "AudioStereo",
        "AudioCompressor"
    ];

    // Serialises settings changes so two media refreshes (e.g. two screen pickers) never run at once
    private settingsQueue: Promise<void> = Promise.resolve();

    public GetSettings(): IUserMediaSettings {
        return JSON.parse(JSON.stringify(this.currentSettings));
    }

    // Takes only the settings being changed, merged into the current settings when the change runs, so a change
    // queued behind a slow one (e.g. an open screen picker) can't carry stale values for the other settings
    public UpdateSettings(changes: SettingChanges): Promise<void> {
        const needsRefresh = Object.keys(changes).some(key => UserMedia.refreshSettingKeys.includes(key));
        if (!needsRefresh) {
            // Cheap changes (gain, compressor, meter...) apply straight away, even while a refresh is in progress
            this.MergeChanges(changes);
            this.NotifySettingsChanged();
            return Promise.resolve();
        }

        const changesMedia = Object.keys(changes).some(key =>
            UserMedia.refreshSettingKeys.includes(key) && this.currentSettings[key]?.Value !== changes[key]);
        const screenWanted = changes.hasOwnProperty("ScreenEnabled") ? changes["ScreenEnabled"] : this.currentSettings.ScreenEnabled.Value;
        if (changesMedia && screenWanted) {
            // Safari only allows getDisplayMedia synchronously inside the user's gesture, before any await
            UserMedia.StopWhenReady(this.TakeDisplayRequest());
            this.pendingDisplayRequest = UserMedia.RequestDisplayMedia(changes["VideoFrameRate"] ?? this.currentSettings.VideoFrameRate.Value);
        }

        return this.Enqueue(() => this.ApplyChanges(changes));
    }

    private pendingDisplayRequest: Promise<MediaStream> = null;

    private static RequestDisplayMedia(frameRate: number): Promise<MediaStream> {
        let request: Promise<MediaStream>;
        try {
            request = navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: frameRate } } });
        }
        catch (err) {
            request = Promise.reject(err);
        }
        request.catch((): void => undefined);
        return request;
    }

    private TakeDisplayRequest(): Promise<MediaStream> {
        const request = this.pendingDisplayRequest;
        this.pendingDisplayRequest = null;
        return request;
    }

    private static StopWhenReady(request: Promise<MediaStream>): void {
        request?.then(stream => stream.getTracks().forEach(track => track.stop()), (): void => undefined);
    }

    public RestoreSettings(changes: SettingChanges): void {
        this.MergeChanges(changes);
        this.NotifySettingsChanged();
    }

    // Acquires media after any settings changes already queued (e.g. ones from the URL), so it uses those settings
    public RefreshMediaStream(): Promise<MediaStream> {
        return this.Enqueue(() => this.GetMediaStream());
    }

    private Enqueue<T>(work: () => Promise<T>): Promise<T> {
        const result = this.settingsQueue.then(work);
        this.settingsQueue = result.then((): void => undefined, (): void => undefined);
        return result;
    }

    private MergeChanges(changes: SettingChanges): void {
        for (const key of Object.keys(changes)) {
            if (this.currentSettings.hasOwnProperty(key)) {
                this.currentSettings[key].Value = changes[key];
            }
        }

        // These are cheap so don't need to be switched on/off
        this.SetCompressionParameters(this.currentSettings);
        this.SetGainParameters(this.currentSettings);
    }

    private async ApplyChanges(changes: SettingChanges): Promise<void> {
        const previousValues: SettingChanges = {};
        for (const key of Object.keys(changes)) {
            if (this.currentSettings.hasOwnProperty(key)) {
                previousValues[key] = this.currentSettings[key].Value;
            }
        }

        const shouldRefreshMediaAccess = Object.keys(previousValues)
            .some(key => UserMedia.refreshSettingKeys.includes(key) && previousValues[key] !== changes[key]);

        this.MergeChanges(changes);

        if (shouldRefreshMediaAccess) {
            try {
                await this.GetMediaStream();
            }
            catch (err) {
                // e.g. the screen picker was cancelled: the previous streams are still running, so put back only
                // the settings this change touched, leaving anything changed in the meantime alone
                this.MergeChanges(previousValues);
                this.NotifySettingsChanged();
                throw err;
            }
        }

        this.NotifySettingsChanged();
    }

    private NotifySettingsChanged(): void {
        if (this.OnSettingsChanged != null) {
            this.OnSettingsChanged(this.GetSettings());
        }
    }

    // The browser ended a video track itself, e.g. its "Stop sharing" bar was used or the camera was unplugged
    private OnVideoTrackEnded(track: MediaStreamTrack, settingKey: string): void {
        if (!this.inputTracks.includes(track)) {
            // Already replaced by a newer stream
            return;
        }

        if (!this.currentSettings[settingKey].Value) {
            return;
        }

        this.UpdateSettings({ [settingKey]: false }).catch(err => console.error(err));
    }

    private GetAudioContext(): AudioContext {
        // Lazy initialise the audio context
        if (this.audioContext == null) {
            this.audioContext = new AudioContext();
            this.audioContext.onstatechange = () => this.CheckAudioState();
            this.CheckAudioState();
        }

        return this.audioContext;
    }

    public get IsAudioBlocked(): boolean {
        return this.audioContext != null && this.audioContext.state !== "running" && this.audioContext.state !== "closed";
    }

    private CheckAudioState(): void {
        if (this.IsAudioBlocked) {
            this.audioContext.resume().catch((): void => undefined);
        }
        if (this.OnAudioStateChanged != null) {
            this.OnAudioStateChanged(this.IsAudioBlocked);
        }
    }

    public ResumeAudio(): Promise<void> {
        if (!this.IsAudioBlocked) {
            return Promise.resolve();
        }
        return this.audioContext.resume();
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

        const displayRequest = this.TakeDisplayRequest();
        if (!this.currentSettings.ScreenEnabled.Value) {
            UserMedia.StopWhenReady(displayRequest);
        }

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        catch (err) {
            UserMedia.StopWhenReady(displayRequest);
            throw err;
        }

        const audioTracks: MediaStreamTrack[] = stream.getAudioTracks();
        console.assert(audioTracks.length == 1, "Expected 1 audio track, there are " + audioTracks.length);

        let videoTracks: MediaStreamTrack[];
        if (this.currentSettings.ScreenEnabled.Value) {
            let screenStream: MediaStream;
            try {
                screenStream = await (displayRequest ?? UserMedia.RequestDisplayMedia(this.currentSettings.VideoFrameRate.Value));
            }
            catch (err) {
                stream.getTracks().forEach(track => track.stop());
                throw err;
            }
            videoTracks = screenStream.getVideoTracks();
            // Screen tracks default to a "detail" content hint, which biases the
            // encoder towards resolution/quality at the expense of frame rate.
            videoTracks.forEach(track => track.contentHint = "motion");
            stream.getVideoTracks().forEach(track => track.stop());
        } else {
            videoTracks = stream.getVideoTracks();
        }

        console.assert(videoTracks.length <= 1, "Expected 1 or 0 video tracks, there are " + videoTracks.length);

        this.ReleaseInputPipeline();

        this.inputStreamAudioNode = this.ProcessAudioTrackToMono(stream);

        this.inputStreamMonitorAudioNode = this.GetAudioContext().createGain();
        this.inputStreamMonitorAudioNode.gain.value = this.currentSettings.AudioLocalListen.Value;
        this.inputStreamMonitorAudioNode.connect(this.GetAudioContext().destination);

        this.inputStreamAudioNode.connect(this.inputStreamMonitorAudioNode);

        let inputStreamNode = this.GetAudioContext().createMediaStreamDestination();
        this.inputStreamAudioNode.connect(inputStreamNode);

        let inputStream = inputStreamNode.stream;
        if (videoTracks.length > 0) {
            const videoTrack = videoTracks[0];
            const settingKey = this.currentSettings.ScreenEnabled.Value ? "ScreenEnabled" : "VideoEnabled";
            videoTrack.addEventListener('ended', () => this.OnVideoTrackEnded(videoTrack, settingKey));
            inputStream.addTrack(videoTrack);
        }

        this.inputNodes.push(this.inputStreamMonitorAudioNode, inputStreamNode);
        this.inputTracks.push(...audioTracks, ...videoTracks, ...inputStream.getAudioTracks());

        if (this.OnMediaStreamAvailable != null) {
            this.OnMediaStreamAvailable(inputStream);
        }

        return inputStream;
    }

    private ReleaseInputPipeline(): void {
        this.inputNodes.forEach(node => node.disconnect());
        this.inputNodes = [];
        this.inputTracks.forEach(track => track.stop());
        this.inputTracks = [];
    }

    // The returned buffers are reused and overwritten on the next call
    private GetTimeDomainDataFromAnalyser(analyserNode: AnalyserNode): Float32Array {
        if (analyserNode == null) {
            return UserMedia.emptyTimeDomainBuffer;
        }

        let sampleBuffer = this.timeDomainBuffers.get(analyserNode);
        if (sampleBuffer === undefined || sampleBuffer.length !== analyserNode.fftSize) {
            sampleBuffer = new Float32Array(analyserNode.fftSize);
            this.timeDomainBuffers.set(analyserNode, sampleBuffer);
        }

        analyserNode.getFloatTimeDomainData(sampleBuffer);
        return sampleBuffer;
    }

    private GetFrequencyDataFromAnalyser(analyserNode: AnalyserNode): Uint8Array {
        if (analyserNode == null) {
            return UserMedia.emptyFrequencyBuffer;
        }

        let sampleBuffer = this.frequencyBuffers.get(analyserNode);
        if (sampleBuffer === undefined || sampleBuffer.length !== analyserNode.frequencyBinCount) {
            sampleBuffer = new Uint8Array(analyserNode.frequencyBinCount);
            this.frequencyBuffers.set(analyserNode, sampleBuffer);
        }

        analyserNode.getByteFrequencyData(sampleBuffer);
        return sampleBuffer;
    }

    public SampleInputTimeDomain(): Float32Array {
        return this.GetTimeDomainDataFromAnalyser(this.inputAnalyserNode);
    }

    public SampleOutputTimeDomain(): Float32Array {
        return this.GetTimeDomainDataFromAnalyser(this.outputAnalyserNode);
    }

    public SampleInputFrequency(): Uint8Array {
        return this.GetFrequencyDataFromAnalyser(this.inputAnalyserNode);
    }
    public SampleOutputFrequency(): Uint8Array {
        return this.GetFrequencyDataFromAnalyser(this.outputAnalyserNode);
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

        this.inputNodes.push(source, this.inputGainNode, this.inputAnalyserNode);
        if (this.inputCompressorNode != null) {
            this.inputNodes.push(this.inputCompressorNode);
        }

        return this.inputAnalyserNode;
    }
}