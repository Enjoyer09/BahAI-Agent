/**
 * bahAI - Provider Capabilities Mapping
 * Inspired by LibreChat's capability mappings.
 */

const Capabilities = {
  CODE_INTERPRETER: 'code_interpreter',
  IMAGE_VISION: 'image_vision',
  RETRIEVAL: 'retrieval',
  ACTIONS: 'actions',
  TOOLS: 'tools',
  SYSTEM_PROMPT: 'system_prompt',
  STREAMING: 'streaming',
  JSON_MODE: 'json_mode',
  MULTI_MODAL: 'multi_modal'
};

const defaultCapabilities = [
  Capabilities.SYSTEM_PROMPT,
  Capabilities.STREAMING
];

const capabilityMap = {
  'openai': [
    ...defaultCapabilities,
    Capabilities.TOOLS,
    Capabilities.IMAGE_VISION,
    Capabilities.JSON_MODE
  ],
  'anthropic': [
    ...defaultCapabilities,
    Capabilities.TOOLS,
    Capabilities.IMAGE_VISION
  ],
  'bedrock': [
    ...defaultCapabilities,
    Capabilities.TOOLS
  ],
  'google': [
    ...defaultCapabilities,
    Capabilities.TOOLS,
    Capabilities.IMAGE_VISION,
    Capabilities.JSON_MODE
  ],
  // Gateways/routers are model-agnostic: they forward to whichever upstream
  // model the request names, so they must be treated as vision- and tool-capable.
  'openrouter': [
    ...defaultCapabilities,
    Capabilities.TOOLS,
    Capabilities.IMAGE_VISION
  ],
  'nvidia': [
    ...defaultCapabilities,
    Capabilities.TOOLS,
    Capabilities.IMAGE_VISION
  ],
  'local': [
    ...defaultCapabilities
  ] // E.g., Ollama, which might not reliably support tools depending on the model
};

function getProviderCapabilities(providerName) {
  return capabilityMap[providerName?.toLowerCase()] || defaultCapabilities;
}

function hasCapability(providerName, capability) {
  const caps = getProviderCapabilities(providerName);
  return caps.includes(capability);
}

module.exports = {
  Capabilities,
  defaultCapabilities,
  capabilityMap,
  getProviderCapabilities,
  hasCapability
};
