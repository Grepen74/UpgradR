import { createServerClient } from "@supabase/ssr";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

import type { WebEnv } from "./env";

export function createSupabaseServerClient(context: Context<{ Bindings: WebEnv }>) {
  return createServerClient(
    context.env.SUPABASE_URL,
    context.env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          const cookieHeader = context.req.header("Cookie");
          if (!cookieHeader) {
            return [];
          }

          return cookieHeader
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
              const separator = part.indexOf("=");
              const name = separator >= 0 ? part.slice(0, separator) : part;
              return {
                name,
                value: getCookie(context, name) ?? "",
              };
            });
        },
        setAll(cookies) {
          for (const cookie of cookies) {
            if (!cookie.value) {
              deleteCookie(context, cookie.name, {
                path: cookie.options.path ?? "/",
              });
              continue;
            }

            setCookie(context, cookie.name, cookie.value, {
              ...cookie.options,
              httpOnly: true,
              secure: new URL(context.env.APP_ORIGIN).protocol === "https:",
              sameSite: "Lax",
              path: cookie.options.path ?? "/",
            });
          }
        },
      },
    },
  );
}

