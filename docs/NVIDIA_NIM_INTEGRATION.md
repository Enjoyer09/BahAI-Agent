# NVIDIA Build / NIM integration

BahAI uses NVIDIA Build hosted models as server-side cloud fallback providers.
Secrets must be configured only on the BahAI or OmniRoute deployment and must
never be shipped in the frontend or Electron package.

## Configuration

```env
NVIDIA_API_KEY=nvapi-...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_GENERAL_MODEL=provider/general-model-id
NVIDIA_FAST_MODEL=provider/fast-model-id
NVIDIA_SMART_MODEL=provider/reasoning-model-id
NVIDIA_CODE_MODEL=provider/code-model-id
NVIDIA_VISION_MODEL=provider/vision-model-id
NVIDIA_FALLBACK_MODELS=provider/fallback-1,provider/fallback-2
```

Copy model IDs exactly from the API example shown for each model at
`https://build.nvidia.com/models`. Do not assume that every model supports
vision or tool calling.

## Routing order

For web cloud traffic, BahAI keeps OmniRoute as the primary control plane and
adds task-matched NVIDIA models before the OpenRouter fallback. For desktop
Cloud Smart mode, NVIDIA code and reasoning models participate in the cloud
provider pool. Desktop Local mode remains Ollama-only.

Provider errors with status `401`, `402`, `429`, quota/credit messages, network
errors, and retryable `5xx` responses trigger the existing provider failover
loop. NVIDIA hosted free endpoints are suitable for development and fallback
capacity, but should not be treated as unlimited production capacity or an SLA.
