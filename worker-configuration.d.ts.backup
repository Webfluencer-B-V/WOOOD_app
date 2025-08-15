// Cloudflare shims (global)

interface KVNamespace {
  get<TValue = unknown>(key: string, type?: "text" | "json" | "arrayBuffer" | "stream"): Promise<TValue | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  readonly scheduledTime: number;
  readonly cron: string;
  waitUntil(promise: Promise<unknown>): void;
}

interface ExportedHandlerEnv {}

// Use app/types/app.WorkerEnv as Env across the app
type Env = import("./app/types/app").WorkerEnv;

interface ExportedHandler<Env = ExportedHandlerEnv, QueueMessage = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> | Response;
  queue?: (batch: { messages: Array<{ ack: () => void }> }, env: Env, ctx: ExecutionContext) => Promise<void> | void;
  scheduled?: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => Promise<void> | void;
}

