export class SpeechSegment {
    constructor({ id, startTime, endTime, energy, audioData, sampleRate }) {
        this.id = id;
        this.startTime = startTime;
        this.endTime = endTime;
        this.energy = energy;
        this.audioData = audioData;
        this.sampleRate = sampleRate;
        this.isProcessed = false;
        this.transcription = '';
        this.isPurged = false;
    }

    getTimingInfo() {
        return {
            startTime: this.startTime,
            endTime: this.endTime,
            duration: this.getDuration()
        };
    }

    getDuration() {
        return this.endTime - this.startTime;
    }

    isSilence() {
        return false;
    }
} 