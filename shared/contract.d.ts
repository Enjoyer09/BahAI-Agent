/** bahAI - Shared Wire Contract (type declarations for contract.js) */

export declare const SSE_EVENT_TYPES: readonly string[];
export declare const MESSAGE_ROLES: readonly ['user', 'assistant', 'tool', 'system'];
export declare const ATTACHMENT_TYPES: readonly ['image', 'document', 'file'];
export declare const WEB_PRIVACY_MEMORY_KEYS: readonly string[];

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
