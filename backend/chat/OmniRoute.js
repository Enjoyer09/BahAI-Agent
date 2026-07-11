/**
 * bahAI - OmniRoute / Freebuff Router
 * A custom intelligent routing system that automatically selects the best 
 * model/provider based on task complexity, prompt length, and domain.
 */

const { detectWireApi } = require('./providers');

class OmniRoute {
  constructor(providers) {
    this.providers = providers; // List of BaseProvider instances
  }

  /**
   * Evaluates the complexity of a prompt to determine the required model class.
   */
  evaluateComplexity(prompt, options = {}) {
    const { hasImage, toolCallsLength } = options;
    
    if (hasImage) return 'VISION';
    
    const words = prompt.split(/\s+/).length;
    const isCode = /```|function|class|def |import |export |=>/i.test(prompt);
    
    if (toolCallsLength > 0 || (isCode && words > 50)) {
      return 'SMART'; // Complex reasoning or heavy coding
    }

    if (words > 1000) {
      return 'LONG_CONTEXT'; // Needs large context window
    }

    return 'FAST'; // Simple queries
  }

  /**
   * Routes the request to the most appropriate provider.
   */
  route(prompt, options = {}) {
    const complexityClass = this.evaluateComplexity(prompt, options);
    
    // Sort providers based on capabilities and speed
    let candidates = this.providers.filter(p => {
      // Logic: If Vision is required, filter providers that don't support VISION
      if (complexityClass === 'VISION' && !p.hasCapability('IMAGE_VISION')) return false;
      if (complexityClass === 'SMART' && !p.hasCapability('TOOLS')) return false;
      return true;
    });

    if (candidates.length === 0) {
      // Fallback to default
      candidates = this.providers;
    }

    // In a real scenario, this would have latency tracking or cost optimization logic
    const selectedProvider = candidates[0];

    console.log(`[OmniRoute] Task classed as ${complexityClass}. Routed to ${selectedProvider.name || 'Default'}`);
    return selectedProvider;
  }
}

module.exports = OmniRoute;
