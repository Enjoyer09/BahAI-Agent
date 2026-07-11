/**
 * bahAI - Stream / Final Response Handling Pattern
 * Transplanted from LibreChat
 * Provides a standardized way to buffer streams, handle SSE events, and manage stream state.
 */

const { Readable } = require('stream');

class StreamHandler extends Readable {
  constructor(options = {}) {
    super(options);
    this.buffer = '';
    this.isFinished = false;
    this.onUpdate = options.onUpdate || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  _read() {
    // Required for stream.Readable but we push data manually
  }

  handleChunk(chunkText) {
    if (this.isFinished) return;
    
    this.buffer += chunkText;
    this.push(chunkText);
    
    // Trigger onUpdate callback for mid-stream processing (e.g. SSE to client)
    try {
      this.onUpdate(chunkText, this.buffer);
    } catch (e) {
      console.error('Error in stream onUpdate:', e);
    }
  }

  finish(finalData = null) {
    if (this.isFinished) return;
    this.isFinished = true;
    
    this.push(null); // EOF
    
    try {
      this.onComplete(this.buffer, finalData);
    } catch (e) {
      console.error('Error in stream onComplete:', e);
    }
  }

  handleError(error) {
    if (this.isFinished) return;
    this.isFinished = true;
    
    try {
      this.onError(error);
    } catch (e) {
      console.error('Error in stream onError:', e);
    }
    
    // Destroy stream with error
    this.destroy(error);
  }
}

/**
 * Utility to simulate a stream from a full text response (TextStream pattern in LibreChat)
 */
async function simulateStream(fullText, onProgressCallback, delayMs = 10, chunkSize = 4) {
  for (let i = 0; i < fullText.length; i += chunkSize) {
    const chunk = fullText.slice(i, i + chunkSize);
    onProgressCallback(chunk);
    await new Promise(r => setTimeout(r, delayMs));
  }
}

module.exports = {
  StreamHandler,
  simulateStream
};
