import { hc } from "hono/client";
import type { AppType } from "@easycode/server";

function getAuthToken(): string | null {
  return process.env.CLERK_SESSION_TOKEN ?? null;
}

function createHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export const apiClient = hc<AppType>(
  process.env.API_URL ?? "http://localhost:3000",
  {
    headers: createHeaders(),
  }
);