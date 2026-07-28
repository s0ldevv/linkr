import {
  parseJsonBody,
  readBoundedBodyText,
  stringField,
} from "./agent_api_core.ts";
import { AgentApiError } from "./agent_api_errors.ts";

Deno.test("agent request bodies are read exactly within the byte limit", async () => {
  const body = '{"name":"Launch"}';
  const request = new Request("https://example.test", {
    method: "POST",
    body,
  });
  const text = await readBoundedBodyText(request, 64);
  if (text !== body) throw new Error("agent body changed while reading");
  const parsed = parseJsonBody(text) as Record<string, unknown>;
  if (stringField(parsed, ["name"], { required: true }) !== "Launch") {
    throw new Error("bounded agent body did not parse");
  }
});

Deno.test("agent request bodies reject content beyond the byte limit", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: "123456",
  });
  let thrown: unknown = null;
  try {
    await readBoundedBodyText(request, 5);
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof AgentApiError) || thrown.status !== 413) {
    throw new Error("oversized agent body was not rejected with HTTP 413");
  }
});
