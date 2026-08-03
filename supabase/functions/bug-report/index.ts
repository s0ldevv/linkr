// deno-lint-ignore-file no-explicit-any
import { jsonResponse, withSensitiveCors } from "../_shared/cors.ts";
import {
  isLinkrPublicOrigin,
  isLoopbackOrigin,
} from "../_shared/app_origins.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  consumeRateLimit,
  rateLimitResponse,
  readJsonBody,
  safeErrorResponse,
} from "../_shared/http.ts";

const CATEGORIES = new Set([
  "functionality",
  "transaction",
  "wallet",
  "account",
  "interface",
  "other",
]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function cleanRequiredText(
  value: unknown,
  min: number,
  max: number,
  error: string,
): string {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) throw new Error(error);
  return text;
}

function cleanOptionalText(
  value: unknown,
  max: number,
  error: string,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > max) throw new Error(error);
  return text;
}

async function requestFingerprint(req: Request): Promise<string> {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]
    ?.trim();
  const source = req.headers.get("cf-connecting-ip")?.trim() ||
    forwardedFor ||
    `${req.headers.get("user-agent") ?? "unknown"}:${
      req.headers.get("origin") ?? "unknown"
    }`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`bug-report:${source}`),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function requestOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin")?.trim();
  if (!origin || origin === "null") return true;
  return isLinkrPublicOrigin(origin) || isLoopbackOrigin(origin);
}

Deno.serve(async (req) => withSensitiveCors(req, await handleBugReport(req)));

async function handleBugReport(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!requestOriginAllowed(req)) {
    return jsonResponse({ error: "origin_not_allowed" }, { status: 403 });
  }

  try {
    const body = (await readJsonBody(req, 16 * 1024)) as Record<
      string,
      unknown
    >;

    // Quietly absorb automated form submissions that fill the hidden field.
    if (String(body.website ?? "").trim()) {
      return jsonResponse({ ok: true }, { status: 201 });
    }

    const title = cleanRequiredText(body.title, 5, 140, "invalid_title");
    const description = cleanRequiredText(
      body.description,
      20,
      4000,
      "invalid_description",
    );
    const category = String(body.category ?? "")
      .trim()
      .toLowerCase();
    const severity = String(body.severity ?? "")
      .trim()
      .toLowerCase();
    if (!CATEGORIES.has(category)) throw new Error("invalid_category");
    if (!SEVERITIES.has(severity)) throw new Error("invalid_severity");

    const admin = serviceClient();
    const rateLimit = await consumeRateLimit(admin, {
      subjectType: "bug_report_public",
      subjectId: await requestFingerprint(req),
      windowSeconds: 60 * 60,
      limit: 6,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt);

    const { data, error } = await admin
      .from("bug_reports")
      .insert({
        title,
        category,
        severity,
        description,
        steps_to_reproduce: cleanOptionalText(
          body.steps_to_reproduce,
          4000,
          "invalid_steps",
        ),
        expected_behavior: cleanOptionalText(
          body.expected_behavior,
          2000,
          "invalid_expected_behavior",
        ),
        page_path: cleanOptionalText(body.page_path, 500, "invalid_page_path"),
      })
      .select("id,created_at")
      .single();
    if (error) throw error;

    return jsonResponse({ ok: true, report: data }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, {
      functionName: "bug-report",
      status: 400,
    });
  }
}
