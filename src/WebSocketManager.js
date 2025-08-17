import { compress } from 'lz4js';

export class WebSocketManager {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.backlog = new Map(); // Store unsent segments
        this.eventListeners = new Map(); // Change to Map for event-specific listeners
        this.pendingResponses = new Map(); // Track pending transcriptions
        this._messageSequence = 0;  // Add sequence counter
        this.crcTable = null; // Add crcTable property
        this.format = 'int16-lz4'; // Default format
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.sendAudioSegment = this.sendAudioSegment.bind(this);
        this.processBacklog = this.processBacklog.bind(this);

        // Subscribe to our own event to clear pending responses.
        // This is done in the constructor to ensure it's only set up once.
        this.subscribe('transcriptionComplete', (transcriptionData) => {
            const receivedSequence = transcriptionData.sequence_num;
            if (typeof receivedSequence !== 'number') {
                return; // No sequence number in this payload, can't clear anything.
            }

            let segmentIdToDelete = null;
            // Find the segmentId that corresponds to the received sequence number.
            for (const segmentId of this.pendingResponses.keys()) {
                // Assumes segmentId is in the format "segment_X"
                const storedSequence = parseInt(segmentId.split('_')[1], 10);
                if (storedSequence === receivedSequence) {
                    segmentIdToDelete = segmentId;
                    break; // Found the matching segment
                }
            }

            if (segmentIdToDelete) {
                this.pendingResponses.delete(segmentIdToDelete);
                console.log(`[WSManager] Cleared pending response for completed segment: ${segmentIdToDelete} (via sequence: ${receivedSequence})`);
            } else {
                // This might happen if a response arrives for a segment that was never pending, which would be unusual.
                console.warn(`[WSManager] Received transcription for sequence ${receivedSequence}, but no matching pending response was found.`);
            }
        });
    }

    async connect() {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        try {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('🌐 WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                this.notifyListeners('connected', null);
                this.processBacklog();
            };

            this.ws.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.isConnected = false;
                this.notifyListeners('disconnected');
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.notifyListeners('error', error);
            };

            this.ws.onmessage = async (event) => {
                try {
                    if (typeof event.data === 'string') {
                        const message = JSON.parse(event.data);
                        
                        // Differentiate message types based on the 'type' field
                        if (message.type === 'vad_classification') {
                            console.log('📥 Received VAD Classification:', message);
                            // Notify listeners specifically for VAD classification
                            this.notifyListeners('vad_classification', message);
                        } 
                        // Check for Parakeet transcription payload fields (e.g., presence of 'words' or other distinct markers)
                        // and absence of a 'type' field that we handle differently.
                        else if (message.session_id && message.sequence_num !== undefined && message.words) {
                            console.log('📥 Received Parakeet Transcription Payload:', {
                                session_id: message.session_id,
                                sequence_num: message.sequence_num,
                                is_final: message.is_final,
                                utterance_text: message.utterance_text?.substring(0, 30) + (message.utterance_text?.length > 30 ? '...' : ''),
                                word_count: message.words?.length || 0,
                                has_metrics: !!message.metrics
                            });
                            // Notify listeners for transcription completion
                            this.notifyListeners('transcriptionComplete', message);
                        } else {
                            // Handle other message types or log as unknown
                            console.log('📥 Received Other/Unknown WebSocket message:', message);
                            // Optionally, notify generic listeners or a specific 'unknown_message' event
                            this.notifyListeners('unknown_message', message); 
                        }
                    }
                } catch (error) {
                    console.error('Failed to process WebSocket message:', error);
                }
            };

        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.attemptReconnect();
        }
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.notifyListeners('maxRetriesReached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        this.connect();
    }

    float32ToInt16(float32Array) {
        return Int16Array.from(float32Array, x => {
            // Clamp to [-1, 1] to avoid overflow
            const val = Math.max(-1, Math.min(1, x)) * 0x7FFF; // 32767
            return Math.round(val);
        });
    }

    async sendAudioSegment(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('WebSocket not ready, adding to backlog:', data.segmentId);
            this.backlog.set(data.segmentId, { data });
            return;
        }

        try {
            if (!data.audioData || !(data.audioData instanceof Float32Array)) {
                throw new Error('Invalid audio data format. Expected Float32Array.');
            }

            // Extract numeric sequence from segment_id
            const sequence = parseInt(data.segmentId.split('_')[1]);

            const startTime = performance.now();
            let audioBuffer;
            let format = this.format;
            let originalSize = data.audioData.byteLength;
            let compressedSize = originalSize;
            let conversionTime = 0;
            let compressionTime = 0;
            let uncompressedLength = 0;
            let samplesCount = data.audioData.length;

            if (format === 'int16-lz4') {
                const conversionStartTime = performance.now();
                const int16Data = this.float32ToInt16(data.audioData);
                conversionTime = performance.now() - conversionStartTime;

                const compressionStartTime = performance.now();
                // Calculate exact sizes
                uncompressedLength = int16Data.byteLength;  // This should be samplesCount * 2
                console.debug('Size check:', {
                    samplesCount,
                    int16DataByteLength: int16Data.byteLength,
                    expectedInt16ByteLength: samplesCount * 2,
                    originalFloat32ByteLength: originalSize
                });

                const compressed = compress(new Uint8Array(int16Data.buffer));
                compressionTime = performance.now() - compressionStartTime;
                
                // Only add the segment ID header (4 bytes)
                const headerSize = 4;  // just segment ID
                const finalBuffer = new Uint8Array(headerSize + compressed.length);
                
                // Write sequence number (4 bytes)
                const sequenceView = new Uint32Array(finalBuffer.buffer, 0, 1);
                sequenceView[0] = sequence;
                
                // Write compressed data
                finalBuffer.set(compressed, headerSize);
                
                audioBuffer = finalBuffer.buffer;
                compressedSize = audioBuffer.byteLength;

                // Verify the data structure
                console.debug('Data structure check:', {
                    totalSize: finalBuffer.length,
                    headerSize,
                    compressedDataSize: compressed.length,
                    uncompressedLength,
                    sequence,
                    firstFourBytes: Array.from(finalBuffer.slice(0, 4))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join(' '),
                    compressedDataStart: Array.from(finalBuffer.slice(4, 8))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join(' ')
                });

                // Create metadata for int16-lz4 format
                const crcStartTime = performance.now();
                const crc32 = this.calculateCRC32(new Uint8Array(int16Data.buffer)).toString(16);
                const crcTime = performance.now() - crcStartTime;
                console.debug('CRC32 Calculation:', {
                    time: `${crcTime.toFixed(2)}ms`,
                    dataSize: `${(int16Data.byteLength / 1024).toFixed(2)} KB`
                });
                const metadata = {
                    type: 'metadata',
                    payload: {
                        type: 'audio_segment',
                        model: data.model,
                        segment_id: data.segmentId,
                        session_id: data.sessionId,
                        start_time: typeof data.startTime === 'number' ? data.startTime : undefined,
                        end_time: typeof data.endTime === 'number' ? data.endTime : undefined,
                        language: data.language,
                        compute_type: data.computeType || 'int8',
                        sample_rate: data.inputSampleRate,
                        format: format,
                        channels: 1,
                        length: samplesCount,
                        crc32,
                        uncompressedLength,
                        bytesPerSample: 2,
                        endianness: 'little',
                        compression: 'lz4',
                        samplesCount,
                        expectedDecompressedSize: samplesCount * 2,
                        compressedSize: compressed.length,
                        sequence,
                        mature_cursor_time: data.matureCursorTime
                    }
                };

                const totalTime = performance.now() - startTime;
                const compressionRatio = originalSize / compressedSize;

                // Log performance metrics
                console.log('Audio Processing Metrics:', {
                    format,
                    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
                    compressedSize: `${(compressedSize / 1024).toFixed(2)} KB`,
                    compressionRatio: compressionRatio.toFixed(2),
                    conversionTime: `${conversionTime.toFixed(2)}ms`,
                    compressionTime: `${compressionTime.toFixed(2)}ms`,
                    totalTime: `${totalTime.toFixed(2)}ms`,
                    uncompressedLength,
                    samplesCount,
                    bytesPerSample: format === 'int16-lz4' ? 2 : 4
                });

                console.log('Sending metadata:', {
                    type: 'metadata',
                    payload: {
                        ...metadata.payload,
                        start_time: metadata.payload.start_time === undefined ? ' UNDEFINED' : metadata.payload.start_time,
                        end_time: metadata.payload.end_time === undefined ? ' UNDEFINED' : metadata.payload.end_time,
                        mature_cursor_time: metadata.payload.mature_cursor_time
                    }
                });
                this.ws.send(JSON.stringify(metadata));
                this.ws.send(audioBuffer);

            } else {
                audioBuffer = data.audioData.buffer;
                
                // Create metadata for float32 format
                const metadata = {
                    type: 'metadata',
                    payload: {
                        type: 'audio_segment',
                        model: data.model,
                        segment_id: data.segmentId,
                        session_id: data.sessionId,
                        start_time: typeof data.startTime === 'number' ? data.startTime : undefined,
                        end_time: typeof data.endTime === 'number' ? data.endTime : undefined,
                        language: data.language,
                        compute_type: data.computeType || 'int8',
                        sample_rate: data.inputSampleRate,
                        format: format,
                        channels: 1,
                        length: samplesCount,
                        crc32: this.calculateCRC32(new Uint8Array(data.audioData.buffer)).toString(16),
                        uncompressedLength: originalSize,
                        bytesPerSample: 4,
                        endianness: 'little',
                        compression: 'none',
                        samplesCount,
                        expectedDecompressedSize: samplesCount * 4,
                        compressedSize: null,
                        sequence,
                        mature_cursor_time: data.matureCursorTime
                    }
                };

                const totalTime = performance.now() - startTime;
                const compressionRatio = originalSize / compressedSize;

                // Log performance metrics
                console.log('Audio Processing Metrics:', {
                    format,
                    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
                    compressedSize: `${(compressedSize / 1024).toFixed(2)} KB`,
                    compressionRatio: compressionRatio.toFixed(2),
                    conversionTime: `${conversionTime.toFixed(2)}ms`,
                    compressionTime: `${compressionTime.toFixed(2)}ms`,
                    totalTime: `${totalTime.toFixed(2)}ms`,
                    uncompressedLength,
                    samplesCount,
                    bytesPerSample: format === 'int16-lz4' ? 2 : 4
                });

                console.log('Sending metadata:', {
                    type: 'metadata',
                    payload: {
                        ...metadata.payload,
                        start_time: metadata.payload.start_time === undefined ? ' UNDEFINED' : metadata.payload.start_time,
                        end_time: metadata.payload.end_time === undefined ? ' UNDEFINED' : metadata.payload.end_time,
                        mature_cursor_time: metadata.payload.mature_cursor_time
                    }
                });
                this.ws.send(JSON.stringify(metadata));
                this.ws.send(audioBuffer);
            }

            // Track pending response
            this.pendingResponses.set(data.segmentId, { 
                timestamp: Date.now(), 
                options: data 
            });

            // Notify listeners of successful send
            this.notifyListeners('segment_sent', data.segmentId);

        } catch (error) {
            console.error(`Failed to send segment ${data.segmentId}:`, error);
            throw error;
        }
    }

    // CRC32 implementation optimized for large arrays
    calculateCRC32(data) {
        // Pre-calculate CRC table for better performance
        if (!this.crcTable) {
            this.crcTable = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                this.crcTable[i] = c;
            }
        }

        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc = (crc >>> 8) ^ this.crcTable[(crc ^ data[i]) & 0xFF];
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    async processBacklog() {
        if (!this.isConnected || this.backlog.size === 0) return;

        console.log(`🔄 Processing backlog (${this.backlog.size} segments)`);

        const backlogEntries = Array.from(this.backlog.entries());
        for (const [segmentId, { data }] of backlogEntries) {
            try {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    await this.sendAudioSegment(data);
                    this.backlog.delete(segmentId);
                }
            } catch (error) {
                console.error(`Failed to process backlogged segment ${segmentId}:`, error);
            }
        }
    }

    handleTranscriptionResponse(response) {
        console.log('🎯 Processing transcription response:', {
            segmentId: response.segmentId,
            sessionId: response.sessionId,
            sequence: response.sequence,
            text: response.segments?.[0]?.text
        });

        const segmentId = response.segmentId;
        const pending = this.pendingResponses.get(segmentId);

        if (!pending) {
            console.warn(`Received response for unknown segment: ${segmentId}`);
            return;
        }

        this.pendingResponses.delete(segmentId);
    }

    subscribe(eventType, callback) {
        if (typeof callback !== 'function') {
            console.error('Callback must be a function:', callback);
            return;
        }

        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, new Set());
        }
        this.eventListeners.get(eventType).add(callback);

        // Return unsubscribe function
        return () => {
            const listeners = this.eventListeners.get(eventType);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    notifyListeners(eventType, data) {
        // Get listeners for this event type
        const listeners = this.eventListeners.get(eventType);
        if (listeners) {
            listeners.forEach(listener => {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`Error in ${eventType} listener:`, error);
                }
            });
        }

        // Also notify general listeners
        const generalListeners = this.eventListeners.get('*');
        if (generalListeners) {
            generalListeners.forEach(listener => {
                try {
                    listener(eventType, data);
                } catch (error) {
                    console.error(`Error in general listener:`, error);
                }
            });
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    // Health check method
    async checkConnection() {
        if (!this.isConnected) {
            console.log('Connection check failed, attempting reconnect...');
            await this.connect();
        }
        return this.isConnected;
    }

    // Start periodic health checks
    startHealthCheck(interval = 5000) {
        this.healthCheckInterval = setInterval(() => {
            this.checkConnection();
        }, interval);
    }

    // Stop health checks
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }

    handleMessage(event) {
        if (typeof event.data === 'string') {
            try {
                const data = JSON.parse(event.data);
                
                // Updated to check for Parakeet payload fields
                if (data.session_id && data.sequence_num !== undefined) {
                    console.log('📥 Parsed WebSocket message:', {
                        session_id: data.session_id,
                        sequence_num: data.sequence_num,
                        is_final: data.is_final,
                        utterance_text: data.utterance_text?.substring(0, 30) + (data.utterance_text?.length > 30 ? '...' : ''),
                        word_count: data.words?.length || 0
                    });

                    // Emit transcription complete event with the full Parakeet payload
                    this.notifyListeners('transcriptionComplete', data);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        }
    }
}

// Export the class only, not an instance