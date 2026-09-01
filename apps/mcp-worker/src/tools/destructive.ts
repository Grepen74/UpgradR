import type { McpServer } from "@modelcontextprotocol/server";

import { ToolInputError } from "../http/errors";
import {
  buildPendingOperationTarget,
  confirmOperationSchema,
  prepareDestructiveOperationSchema,
} from "../validation/destructive";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

interface PendingOperationRow {
  id: string;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  operation_type: string;
  target: unknown;
  confirmation_token: string;
  expires_at: string;
  confirmed_at: string | null;
}

interface ExecutedOperation {
  success: boolean;
  operation_id: string;
  status: "confirmed" | "expired";
  operation_type: string;
  reason?: string;
  execution?: Record<string, unknown>;
}

/**
 * Two-step, single-use destructive confirmation, per
 * docs/architecture.md: "Deletes and bulk operations use a two-step,
 * single-use confirmation." Backed by
 * `supabase/migrations/20250115121000_mcp_pending_operations.sql`: the
 * Worker inserts a `mcp_pending_operations` row (prepare), then calls
 * `public.execute_mcp_pending_operation()` (confirm). The database validates
 * ownership, single-use, expiry, operation type, and target and performs the
 * destructive action in the same transaction, so confirmation can never be
 * committed without its corresponding execution.
 */
export function registerDestructiveTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "prepare_destructive_operation",
    {
      title: "Prepare destructive operation",
      description:
        "Request a single-use confirmation token for a destructive action (e.g. deleting an application, follow-up, or note, or archiving a batch of applications). The action does not happen until confirm_operation is called with the returned token, and the token expires after 15 minutes.",
      inputSchema: prepareDestructiveOperationSchema,
    },
    async (input, { supabase, auth }) => {
      const target = {
        ...buildPendingOperationTarget(input),
        ...(input.reason ? { reason: input.reason } : {}),
      };

      const row = await supabase.insert<PendingOperationRow>(
        "mcp_pending_operations",
        {
          owner_id: auth.extra.userId,
          mcp_client_id: auth.clientId,
          operation_type: input.operationType,
          target,
        },
        { single: true },
      );

      const result = {
        operationToken: row.confirmation_token,
        operationType: row.operation_type,
        expiresAt: row.expires_at,
        status: row.status,
      };

      return {
        content: [
          {
            type: "text",
            text: `Confirmation required: call confirm_operation with operationToken "${result.operationToken}" before ${result.expiresAt} to proceed with ${result.operationType}.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "confirm_operation",
    {
      title: "Confirm operation",
      description:
        "Execute a previously prepared destructive operation using its single-use confirmation token from prepare_destructive_operation.",
      inputSchema: confirmOperationSchema,
    },
    async ({ operationToken }, { supabase }) => {
      const operation = await supabase.rpc<ExecutedOperation>("execute_mcp_pending_operation", {
        p_token: operationToken,
      });

      if (!operation.success) {
        throw new ToolInputError(
          operation.reason === "token_expired"
            ? "This confirmation token has expired. Prepare the operation again."
            : "The operation was not executed.",
        );
      }

      const result = {
        operationType: operation.operation_type,
        status: operation.status,
        execution: operation.execution ?? {},
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
