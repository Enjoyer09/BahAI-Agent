const { getProviderCapabilities, hasCapability } = require('./capabilities');

/**
 * BaseProvider Skeleton
 * Transplanted from LibreChat's BaseClient.
 * This class abstracts the core interactions with different AI providers.
 */
class BaseProvider {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.options = options;
    this.providerName = options.providerName || 'unknown';
    this.capabilities = getProviderCapabilities(this.providerName);
    this.modelOptions = options.modelOptions || {};
  }

  /**
   * Checks if the provider supports a specific capability.
   */
  supports(capability) {
    return hasCapability(this.providerName, capability);
  }

  /**
   * Initialize or setup client
   * To be overridden by subclasses
   */
  setupClient() {
    throw new Error('setupClient must be implemented by subclass');
  }

  /**
   * Builds the payload for the specific provider's API.
   * To be overridden by subclasses.
   */
  buildPayload(messages, context) {
    throw new Error('buildPayload must be implemented by subclass');
  }

  /**
   * Sends the completion request.
   * To be overridden by subclasses.
   */
  async getCompletion(payload, callbacks) {
    throw new Error('getCompletion must be implemented by subclass');
  }

  /**
   * Sends a streaming completion request.
   * To be overridden by subclasses.
   */
  async streamCompletion(payload, callbacks) {
    throw new Error('streamCompletion must be implemented by subclass');
  }

  /**
   * Universal format for handling files/attachments
   * before sending them to the specific provider format.
   */
  formatAttachments(attachments) {
    if (!this.supports('image_vision')) {
      // Strip attachments if the provider/model doesn't support vision
      return [];
    }
    // Base implementation (can be overridden)
    return attachments;
  }
}

module.exports = BaseProvider;
