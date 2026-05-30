import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as Sentry from "@sentry/hono/bun";
import { getAuth } from "@hono/clerk-auth";
import { db } from "@easycode/database/client";
import { Role, Mode, MessageStatus } from "@easycode/database/enums";
import { findSupportedChatModel } from "@easycode/shared";

const createSessionSchema = z.object({
  title: z.string(),
  cwd: z.string().optional(),
  initialMessage: z
    .object({
      role: z.enum(Role),
      content: z.string(),
      mode: z.enum(Mode),
      model: z.string()
        .refine((id) => !!findSupportedChatModel(id), "Unsupported model"),
    })
    .optional(),
});

const createSessionValidator = zValidator(
  "json", createSessionSchema, (result, c) => {
  if (!result.success) {
    Sentry.logger.warn("Session creation validation failed", {
        path: c.req.path,
        issues: result.error.issues.length
    });

    return c.json({ error: "Invalid request body" }, 400);
  }
});

const app = new Hono()
  .get("/", async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const sessions = await db.session.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    Sentry.logger.info("Listed sessions", {
        count: sessions.length,
    })

    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param("id");
    
    const session = await db.session.findUnique({
      where: { id, userId: auth.userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
        Sentry.logger.warn("Session not found", {
            sessionId: id,
            userId: auth.userId,
        })
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  })
  .post("/", createSessionValidator, async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const { initialMessage, ...data } = c.req.valid("json");

    const session = await db.session.create({
      data: {
        ...data,
        userId: auth.userId,
        ...(initialMessage && {
          messages: {
            create: {
              ...initialMessage,
              status: MessageStatus.COMPLETE,
            },
          },
        })
      },
      include: { messages: true },
    });

    return c.json(session, 201);
  });

export default app;