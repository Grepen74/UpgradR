import type { Context } from "hono";

import type { WebEnv } from "./env";
import { createSupabaseServerClient } from "./supabase";

export type AuthenticatedContext = {
  userId: string;
  supabase: ReturnType<typeof createSupabaseServerClient>;
};

// Shared by every route module: resolves the signed-in user from the
// request's Supabase session cookies, or returns a 401 Response the caller
// should return directly.
export async function authenticated(
  context: Context<{ Bindings: WebEnv }>,
): Promise<AuthenticatedContext | Response> {
  const supabase = createSupabaseServerClient(context);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return context.json({ error: "Authentication required" }, 401);
  }
  return { userId: data.user.id, supabase };
}
