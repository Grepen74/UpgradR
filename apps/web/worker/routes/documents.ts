import { Hono } from "hono";

import {
  DOCUMENT_MAX_COUNT_PER_OWNER,
  DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
  DOCUMENT_VALIDATION_MESSAGES,
  DOCUMENT_VALIDATION_STATUS,
  validateDocumentContent,
  validateDocumentFile,
  wouldExceedDocumentQuota,
} from "../../shared/documents";
import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import type { WebEnv } from "../env";
import { documentKindSchema, documentLinkCreateSchema, uuidParamSchema } from "../validation";

// Short-lived: long enough for a browser to start the download after
// requesting the link, short enough that a leaked URL is useless quickly.
const SIGNED_URL_TTL_SECONDS = 60;

const DOCUMENT_COLUMNS = "id,kind,file_name,mime_type,size_bytes,created_at,updated_at";
const DOCUMENT_LINK_COLUMNS = "id,document_id,application_id,role,created_at";

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[/\\]+/g, "_");
  return trimmed.length > 0 ? trimmed.slice(-200) : "document";
}

function storagePathFor(ownerId: string, fileName: string): string {
  // Owner-prefixed so it satisfies both the documents_storage_path_owner_prefix
  // check constraint and the storage.objects RLS policies (see
  // supabase/migrations/20250115120800_documents.sql and .../121100_storage.sql).
  return `${ownerId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

export const documentsRoute = new Hono<{ Bindings: WebEnv }>();

documentsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const [documentsResult, linksResult] = await Promise.all([
    auth.supabase
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("owner_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(200),
    auth.supabase
      .from("application_documents")
      .select(DOCUMENT_LINK_COLUMNS)
      .eq("owner_id", auth.userId),
  ]);
  if (documentsResult.error) {
    return context.json({ error: "Unable to load documents" }, 502);
  }
  if (linksResult.error) {
    return context.json({ error: "Unable to load document links" }, 502);
  }

  const data = documentsResult.data;
  const linksByDocumentId = new Map<string, (typeof linksResult.data)[number][]>();
  for (const link of linksResult.data) {
    const existingLinks = linksByDocumentId.get(link.document_id) ?? [];
    existingLinks.push(link);
    linksByDocumentId.set(link.document_id, existingLinks);
  }

  const documents = data.map((document) => ({
    ...document,
    links: linksByDocumentId.get(document.id) ?? [],
  }));

  const usedBytes = data.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0);
  return context.json({
    documents,
    quota: {
      usedBytes,
      maxBytes: DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
      count: data.length,
      maxCount: DOCUMENT_MAX_COUNT_PER_OWNER,
    },
  });
});

documentsRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    return context.json({ error: "Expected a multipart/form-data upload" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return context.json({ error: "Choose a file to upload" }, 400);
  }

  const validationError = validateDocumentFile(file);
  if (validationError) {
    return context.json(
      { error: DOCUMENT_VALIDATION_MESSAGES[validationError] },
      DOCUMENT_VALIDATION_STATUS[validationError] as 400 | 413 | 415,
    );
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const contentError = validateDocumentContent(fileBytes, file.type);
  if (contentError) {
    return context.json(
      { error: DOCUMENT_VALIDATION_MESSAGES[contentError] },
      DOCUMENT_VALIDATION_STATUS[contentError] as 400 | 413 | 415,
    );
  }

  const kindParsed = documentKindSchema.safeParse(form.get("kind") ?? "other");
  if (!kindParsed.success) {
    return context.json({ error: "Invalid document kind" }, 400);
  }

  const replaceIdRaw = form.get("replaceDocumentId");
  let replaceDocumentId: string | undefined;
  if (typeof replaceIdRaw === "string" && replaceIdRaw.length > 0) {
    const parsedId = uuidParamSchema.safeParse(replaceIdRaw);
    if (!parsedId.success) {
      return context.json({ error: "Invalid document to replace" }, 400);
    }
    replaceDocumentId = parsedId.data;
  }

  let existing: { id: string; storage_path: string; size_bytes: number | null } | null = null;
  if (replaceDocumentId) {
    const { data, error } = await auth.supabase
      .from("documents")
      .select("id,storage_path,size_bytes")
      .eq("owner_id", auth.userId)
      .eq("id", replaceDocumentId)
      .maybeSingle();
    if (error || !data) {
      return context.json({ error: "Document to replace was not found" }, 404);
    }
    existing = data;
  }

  // Enforce a soft per-owner quota; the Storage bucket's own file_size_limit
  // only bounds a single object (see
  // supabase/migrations/20250115121100_storage.sql).
  const { data: usageRows, error: usageError } = await auth.supabase
    .from("documents")
    .select("size_bytes")
    .eq("owner_id", auth.userId);
  if (usageError) {
    return context.json({ error: "Unable to verify storage quota" }, 502);
  }
  const currentCount = usageRows.length;
  const currentBytes = usageRows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0);
  if (
    wouldExceedDocumentQuota({
      currentCount,
      currentBytes,
      additionalBytes: file.size,
      isReplacement: existing !== null,
      replacingBytes: existing?.size_bytes ?? 0,
    })
  ) {
    return context.json(
      {
        error: `Storage quota exceeded: up to ${DOCUMENT_MAX_COUNT_PER_OWNER} documents and ${Math.floor(
          DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER / (1024 * 1024),
        )} MB total are allowed. Delete an existing document to free up space.`,
      },
      413,
    );
  }

  const storagePath = storagePathFor(auth.userId, file.name);
  const { error: uploadError } = await auth.supabase.storage
    .from("documents")
    .upload(storagePath, fileBytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return context.json({ error: "Unable to upload document" }, 502);
  }

  const fileName = sanitizeFileName(file.name);
  if (existing) {
    const { data, error } = await auth.supabase
      .from("documents")
      .update({
        kind: kindParsed.data,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .eq("id", existing.id)
      .eq("owner_id", auth.userId)
      .select(DOCUMENT_COLUMNS)
      .single();
    if (error) {
      // The new object was already written; remove it since its metadata
      // row was never saved, rather than leaving an orphaned object.
      await auth.supabase.storage.from("documents").remove([storagePath]);
      return context.json({ error: "Unable to save replacement document" }, 502);
    }

    // Best-effort: remove the superseded object. Its metadata row is gone,
    // so a failure here only leaves an orphaned Storage object (see the
    // cleanup note in supabase/migrations/20250115121100_storage.sql), not a
    // dangling reference.
    const { error: removeError } = await auth.supabase.storage
      .from("documents")
      .remove([existing.storage_path]);
    if (removeError) {
      console.error("Failed to remove superseded document object", { code: removeError.name });
    }

    await recordActivityEvent(auth, {
      entityType: "document",
      entityId: data.id,
      eventType: "replaced",
      payload: { fileName: data.file_name },
    });

    return context.json({ document: data });
  }

  const { data, error } = await auth.supabase
    .from("documents")
    .insert({
      owner_id: auth.userId,
      kind: kindParsed.data,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) {
    await auth.supabase.storage.from("documents").remove([storagePath]);
    return context.json({ error: "Unable to save document" }, 502);
  }

  await recordActivityEvent(auth, {
    entityType: "document",
    entityId: data.id,
    eventType: "uploaded",
    payload: { fileName: data.file_name },
  });

  return context.json({ document: data }, 201);
});

documentsRoute.get("/:id/download", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const documentId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!documentId.success) {
    return context.json({ error: "Invalid document identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("documents")
    .select("storage_path,file_name")
    .eq("owner_id", auth.userId)
    .eq("id", documentId.data)
    .maybeSingle();
  if (error) {
    return context.json({ error: "Unable to load document" }, 502);
  }
  if (!data) {
    return context.json({ error: "Document not found" }, 404);
  }

  const { data: signed, error: signError } = await auth.supabase.storage
    .from("documents")
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: data.file_name,
    });
  if (signError || !signed) {
    return context.json({ error: "Unable to create a download link" }, 502);
  }

  return context.json({
    url: signed.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  });
});

documentsRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const documentId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!documentId.success) {
    return context.json({ error: "Invalid document identifier" }, 400);
  }

  // application_documents rows cascade-delete with the parent document (see
  // supabase/migrations/20250115120800_documents.sql), so no separate unlink
  // step is required here.
  const { data, error } = await auth.supabase
    .from("documents")
    .delete()
    .eq("owner_id", auth.userId)
    .eq("id", documentId.data)
    .select("id,storage_path,file_name")
    .maybeSingle();
  if (error) {
    return context.json({ error: "Unable to delete document" }, 502);
  }
  if (!data) {
    return context.json({ error: "Document not found" }, 404);
  }

  const { error: removeError } = await auth.supabase.storage
    .from("documents")
    .remove([data.storage_path]);
  if (removeError) {
    console.error("Failed to remove document storage object", { code: removeError.name });
  }

  await recordActivityEvent(auth, {
    entityType: "document",
    entityId: data.id,
    eventType: "deleted",
    payload: { fileName: data.file_name },
  });

  return context.json({ deleted: true });
});

documentsRoute.post("/:id/links", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const documentId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!documentId.success) {
    return context.json({ error: "Invalid document identifier" }, 400);
  }

  const parsed = documentLinkCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid application link" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("application_documents")
    .insert({
      owner_id: auth.userId,
      application_id: parsed.data.applicationId,
      document_id: documentId.data,
      role: parsed.data.role ?? "attachment",
    })
    .select(DOCUMENT_LINK_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : error.code === "23503" ? 404 : error.code === "42501" ? 403 : 502;
    return context.json(
      {
        error:
          status === 409
            ? "This document is already linked to that opportunity with this role"
            : status === 404
              ? "Opportunity or document not found"
              : status === 403
                ? "You do not own that opportunity or document"
                : "Unable to link document",
      },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "document",
    entityId: documentId.data,
    eventType: "linked",
    payload: { applicationId: parsed.data.applicationId, role: parsed.data.role ?? "attachment" },
  });

  return context.json({ link: data }, 201);
});

documentsRoute.delete("/:id/links/:linkId", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const documentId = uuidParamSchema.safeParse(context.req.param("id"));
  const linkId = uuidParamSchema.safeParse(context.req.param("linkId"));
  if (!documentId.success || !linkId.success) {
    return context.json({ error: "Invalid link identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("application_documents")
    .delete()
    .eq("owner_id", auth.userId)
    .eq("document_id", documentId.data)
    .eq("id", linkId.data)
    .select("id")
    .maybeSingle();
  if (error) {
    return context.json({ error: "Unable to unlink document" }, 502);
  }
  if (!data) {
    return context.json({ error: "Link not found" }, 404);
  }

  await recordActivityEvent(auth, {
    entityType: "document",
    entityId: documentId.data,
    eventType: "unlinked",
    payload: { linkId: linkId.data },
  });

  return context.json({ unlinked: true });
});

export default documentsRoute;
