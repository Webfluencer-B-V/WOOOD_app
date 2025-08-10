import { createRequestHandler } from "react-router";

import type { WebhookQueueMessage } from "~/types/app";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			ctx: ExecutionContext;
			env: Env;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},

	async queue(batch, _env, _ctx): Promise<void> {
		console.log(`server.queue: ${JSON.stringify(batch.messages)}`);

		for (const message of batch.messages) {
			message.ack();
		}
	},

	async scheduled(event: any, _env: any, _ctx: any): Promise<void> {
		// No-op scheduled handler to satisfy Cloudflare cron triggers
		// You can route cron work to routes or queues from here if needed
		console.log("server.scheduled", { cron: event.cron, scheduledTime: event.scheduledTime });
	}
} satisfies ExportedHandler<Env, WebhookQueueMessage>;