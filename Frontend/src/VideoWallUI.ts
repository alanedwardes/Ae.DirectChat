class Size {
    public Width: number;
    public Height: number;
}

class VideoStream {
    constructor(mediaStream: MediaStream, muted: boolean) {
        this.Stream = mediaStream;

        this.Element = document.createElement("video");
        this.Element.srcObject = mediaStream;
        this.Element.muted = muted;
        this.Element.play();

        const audioTracks: MediaStreamTrack[] = mediaStream.getAudioTracks();
        const videoTracks: MediaStreamTrack[] = mediaStream.getVideoTracks();

        if (audioTracks.length > 0) {
            this.AudioTrack = audioTracks[0];
        }

        if (videoTracks.length > 0) {
            this.VideoTrack = videoTracks[0];
            this.VideoSettings = this.VideoTrack.getSettings();
        }
    }

    public readonly Element: HTMLVideoElement;
    public readonly Stream: MediaStream;
    public readonly AudioTrack: MediaStreamTrack;
    public readonly VideoTrack: MediaStreamTrack;
    public readonly VideoSettings: MediaTrackSettings;
}

export class VideoWall {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private localStream: VideoStream;

    private readonly remoteStreams: Array<VideoStream> = new Array<VideoStream>();

    constructor() {
        this.canvas = document.getElementById('videoWall') as HTMLCanvasElement;
        this.context = this.canvas.getContext("2d");
        this.Render();
    }

    public SetLocalStream(mediaStream: MediaStream) {
        this.localStream = new VideoStream(mediaStream, true);
    }

    public AddRemoteStream(mediaStream: MediaStream) {
        if (this.remoteStreams.filter(stream => stream.Stream.id == mediaStream.id).length > 0) {
            console.warn("Ignoring duplicate remote stream with ID " + mediaStream.id);
            return;
        }

        if (this.localStream != null && mediaStream == this.localStream.Stream) {
            console.error("Ignoring remote media stream as it is the same as the local stream");
            return;
        }

        const newStream: VideoStream = new VideoStream(mediaStream, false);
        this.remoteStreams.push(newStream);
    }

    private CalculateAspectRatioFit(srcWidth: number, srcHeight: number, maxWidth: number, maxHeight: number): Size {
        const ratio: number = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
        const size = new Size();
        size.Width = srcWidth * ratio;
        size.Height = srcHeight * ratio;
        return size;
    }

    private Render() {
        // Resize the canvas
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        if (this.remoteStreams.length > 0) {
            this.DrawRemoteStreams();
        }

        if (this.localStream != null && this.localStream.VideoTrack != null && this.localStream.Stream.active) {
            this.DrawLocalStream();
        }

        window.requestAnimationFrame(() => this.Render());
    }

    private DrawLocalStream() {
        // Calculate the local video size
        const localVideoSize: Size = this.CalculateAspectRatioFit(
            this.localStream.Element.videoWidth,
            this.localStream.Element.videoHeight,
            this.canvas.width / 5,
            this.canvas.height / 5);

        // Draw the local video
        this.context.drawImage(
            this.localStream.Element,
            this.canvas.width - localVideoSize.Width - (this.canvas.width / 30),
            this.canvas.height - localVideoSize.Height - (this.canvas.height / 30),
            localVideoSize.Width,
            localVideoSize.Height);
    }

    private RemoveInactiveRemoteStreams(): void {
        const inactiveStreams: VideoStream[] = this.remoteStreams.filter((stream: VideoStream) => !stream.Stream.active);
        if (inactiveStreams.length > 0) {
            inactiveStreams.forEach((stream: VideoStream) => {
                const index: number = this.remoteStreams.indexOf(stream);
                this.remoteStreams.splice(index, 1);
            });
        }
    }

    private DrawRemoteStreams(): void {
        this.RemoveInactiveRemoteStreams();

        if (this.remoteStreams.length > 0) {
            const videoStream: VideoStream = this.remoteStreams[this.remoteStreams.length - 1];

            if (videoStream.VideoTrack != null) {

                const localVideoSize: Size = this.CalculateAspectRatioFit(
                    videoStream.Element.videoWidth * 99,
                    videoStream.Element.videoHeight * 99,
                    this.canvas.width,
                    this.canvas.height);

                this.context.drawImage(videoStream.Element, 0, 0, localVideoSize.Width, localVideoSize.Height);
            }
        }
    }
}