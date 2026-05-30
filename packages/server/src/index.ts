import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sentry } from "@sentry/hono/bun";
import * as Sentry from "@sentry/hono/bun";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import sessions from "./routes/sessions";
import chat from "./routes/chat"

const app = new Hono();

app.use("*", clerkMiddleware());

app.use(
  sentry(app, {
    dsn: "https://281faa40846cfc10c18d39eb180f0b7e@o4509932684771328.ingest.us.sentry.io/4511439536914432",
    tracesSampleRate: 1.0,
    enableLogs: true,
    sendDefaultPii: true,
  }),
);

app.get("/debug-sentry", () => {
  // Send a log before throwing the error
  Sentry.logger.info('User triggered test error', {
    action: 'test_error_endpoint',
  });
  // Send a test metric before throwing the error
  Sentry.metrics.count('test_counter', 1);
  throw new Error("My first Sentry error!");
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    Sentry.logger.warn("Handled HTTP error", {
        status: error.status,
        message: error.message || "Request failed",
        path: c.req.path,
        method: c.req.method,
    })
    return c.json({ 
      error: error.message || "Request failed",
    }, error.status);
  };

  Sentry.logger.warn("Handled HTTP error", {
    message: error instanceof Error ? error.message : "Unknown error",
    path: c.req.path,
    method: c.req.method,
  })
  return c.json({ error: "Internal server error" }, 500);
});

const routes = app.route("/sessions", sessions).route("/chat", chat);

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };