/**
 * bahAI - Shared Wire Contract (runtime constants)
 *
 * Single source of truth for values that must stay in sync between the
 * backend (CJS) and the frontend (ESM/TS). Frontend imports this through the
 * `@bahai/shared` alias (see vite.config.ts / tsconfig paths); backend
 * requires it directly as `require('../../shared/contract')`.
 *
 * Types for these constants live in contract.d.ts.
 */
'use strict';

/** Every SSE event type the server may emit (web + desktop products). */
const SSE_EVENT_TYPES = [
  'assistant_message',
  'assistant_delta',
  'provider_telemetry',
  'tool_execution',
  'tool_result',
  'task_plan',
  'orchestration_state',
  'orchestration_phase',
  'auto_route',
  'approval_request',
  'approval_resolved',
  'human_checkpoint',
  'governance_state',
  'workspace_updated',
  'token_usage',
  'error',
  'debug',
];

/** Message roles shared between DB, chat runtime and UI. */
const MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system'];

/** Attachment kinds recognized by the pipeline and the chat UI. */
const ATTACHMENT_TYPES = ['image', 'document', 'file'];

/**
 * Project-memory keys that must NEVER reach web chat (provider telemetry,
 * token usage and GUI capability status are desktop ops-panel details).
 * Kept in one place so the frontend scrubber (chatRuntime.ts) and any backend
 * scrubber stay identical.
 */
const WEB_PRIVACY_MEMORY_KEYS = [
  'providerTelemetry',
  'lastProviderTelemetry',
  'tokenUsage',
  'guiCapabilities',
  'guiCapabilitiesUpdatedAt',
];

module.exports = {
  SSE_EVENT_TYPES,
  MESSAGE_ROLES,
  ATTACHMENT_TYPES,
  WEB_PRIVACY_MEMORY_KEYS,
};
