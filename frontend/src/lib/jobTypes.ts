// ==========================================
// Durable job domain types (frontend mirror of backend/jobs/types.js)
// ==========================================

export type JobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Job {
  id: string;
  conversation_id: string | null;
  status: JobStatus;
  resource_class: string;
  priority: number;
  payload: any;
  result: any;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  max_attempts: number;
  created_at?: string;
  finished_at?: string | null;
  queuePosition?: number;
}

// Backend job event as streamed over SSE (payload fields are spread to the top
// level by the backend's writeEvent helper) or as a synthetic `terminal` wrapper.
export interface JobEvent {
  type:
    | 'created'
    | 'claimed'
    | 'progress'
    | 'tool_call'
    | 'provider_telemetry'
    | 'retrying'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'heartbeat'
    | 'terminal';
  seq?: number;
  jobId?: string;
  result?: any;
  content?: string;
  tool?: string;
  tool_call_id?: string;
  status?: JobStatus;
  providerId?: string;
  event?: string;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  // terminal wrapper carries the final job row
  job?: Job;
  [key: string]: any;
}

export type JobStatusListener = (state: {
  jobId: string;
  status: JobStatus;
  queuePosition?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
} | null) => void;
