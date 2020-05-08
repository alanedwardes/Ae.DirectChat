import { v4 as uuidv4 } from 'uuid';

export interface ISessionConfig {
    SessionId: string;
    AttendeeId: string;
    RoomId: string;
}

export class SessionConfig implements ISessionConfig {
    private readonly sessionId: string = uuidv4();
    private readonly attendeeId: string = uuidv4();
    private readonly roomId: string = uuidv4();

    constructor(roomId: string) {
        this.roomId = roomId.length == 0 ? uuidv4() : roomId;
    }

    get SessionId(): string {
        return this.sessionId;
    }

    get AttendeeId(): string {
        return this.attendeeId;
    }

    get RoomId(): string {
        return this.roomId;
    }
}