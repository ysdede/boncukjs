class AudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        // Get the actual sample rate from options
        const sampleRate = options?.processorOptions?.sampleRate;
        if (!sampleRate) {
            console.error('No sample rate provided to AudioProcessor');
            return;
        }
        
        // Use 80ms for window size - perfectly divisible by common sample rates
        // 16000Hz: 80ms = 1280 samples
        // 22050Hz: 80ms = 1764 samples
        // 48000Hz: 80ms = 3840 samples
        const windowDuration = 0.080; // 80ms window size (instead of 100ms)
        this.bufferSize = Math.round(windowDuration * sampleRate);
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        
        this.maxValues = [];
        this.smaLength = 6; // Simple Moving Average length
        this.silenceCounter = 0;
        this.silenceThreshold = 10; // 10 windows of 80ms = 800ms
        this.sampleRate = sampleRate;
        
        console.log('AudioProcessor initialized with sample-rate-aligned window:', {
            sampleRate: this.sampleRate,
            windowDuration: windowDuration,
            bufferSize: this.bufferSize,
            silenceThreshold: this.silenceThreshold
        });
        
        // For visualization
        this.visualizationBuffer = new Float32Array(1024); // Buffer for visualization data
        this.visualizationIndex = 0;
        this.visualizationInterval = 5; // Send visualization data every 5 frames
        this.frameCount = 0;
    }

    calculateMaxEnergy(buffer) {
        const maxAbsValue = Math.max(...Array.from(buffer).map(Math.abs));
        this.maxValues.push(maxAbsValue);
        
        if (this.maxValues.length > this.smaLength) {
            this.maxValues.shift();
        }
        
        const sum = this.maxValues.reduce((acc, val) => acc + val, 0);
        return (sum / this.maxValues.length);
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const numChannels = input.length;

        if (numChannels === 0) {
            return true;
        }

        const channel = input[0];

        if (!channel) return true;

        // Process audio for energy detection and buffering
        for (let i = 0; i < channel.length; i++) {
            let sample = channel[i];

            // Downmix to mono if stereo
            if (numChannels > 1) {
                sample = (sample + input[1][i]) / 2;
            }

            // Store in main processing buffer
            this.buffer[this.bufferIndex++] = sample;
            
            // Also store in visualization buffer with downsampling
            if (i % 2 === 0) { // Downsample by factor of 2 for visualization
                this.visualizationBuffer[this.visualizationIndex++] = sample;
                
                // Reset visualization buffer index if full
                if (this.visualizationIndex >= this.visualizationBuffer.length) {
                    this.visualizationIndex = 0;
                }
            }

            // When main buffer is full, process it
            if (this.bufferIndex >= this.bufferSize) {
                const energy = this.calculateMaxEnergy(this.buffer);
                
                this.port.postMessage({
                    type: 'audio_data',
                    audioData: this.buffer.slice(),
                    energy: energy,
                    sampleRate: this.sampleRate,
                    timestamp: Date.now()
                });
                
                this.bufferIndex = 0;
            }
        }
        
        // Send visualization data periodically
        this.frameCount++;
        if (this.frameCount >= this.visualizationInterval) {
            this.frameCount = 0;
            
            // Create a copy of the visualization buffer
            const visualizationData = new Float32Array(this.visualizationBuffer);
            
            // Send to main thread for waveform display
            this.port.postMessage({
                type: 'visualization_data',
                samples: visualizationData,
                timestamp: Date.now()
            });
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);