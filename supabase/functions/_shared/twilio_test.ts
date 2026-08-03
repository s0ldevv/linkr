import {
  computeTwilioSignature,
  emptyMessagingResponse,
  hashPhone,
  messageResponse,
  normalizePhone,
  normalizeTwilioInbound,
  parseTwilioForm,
  redactPhone,
  smsWorkAcceptanceInput,
  splitSmsText,
  verifyTwilioSignature,
  xmlEscape,
} from "./twilio.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Twilio signature uses the documented URL plus sorted form parameters", async () => {
  const params = new URLSearchParams({
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
    From: "+14158675310",
    To: "+18005551212",
  });
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const signature = await computeTwilioSignature(url, params, "12345");
  assert(
    signature === "L/OH5YylLD5NRKLltdqwSvS0BnU=",
    `unexpected fixture signature: ${signature}`,
  );
  assert(
    await verifyTwilioSignature({ signature, url, params, authToken: "12345" }),
    "valid signature rejected",
  );
  params.set("Digits", "9999");
  assert(
    !(await verifyTwilioSignature({
      signature,
      url,
      params,
      authToken: "12345",
    })),
    "tampered form accepted",
  );
});

Deno.test("form normalization preserves unknown parameters and parses MMS fields", () => {
  const params = parseTwilioForm(
    "MessageSid=SM1234567890123456&AccountSid=AC1234567890123456&From=%2B14165551212&To=%2B14165559876&Body=hello&NumMedia=1&MediaUrl0=https%3A%2F%2Fexample.test%2Fa&MediaContentType0=image%2Fpng&FutureField=yes",
  );
  const inbound = normalizeTwilioInbound(params);
  assert(params.get("FutureField") === "yes", "future parameter lost");
  assert(inbound.media[0]?.content_type === "image/png", "media not parsed");
  assert(inbound.from === "+14165551212", "phone not normalized");
});

Deno.test("TwiML always escapes provider and model text", async () => {
  assert(
    xmlEscape(`<&>"'`) === "&lt;&amp;&gt;&quot;&apos;",
    "XML escaping mismatch",
  );
  const response = messageResponse("A&B <ok>");
  assert(
    (await response.text()).includes("A&amp;B &lt;ok&gt;"),
    "unsafe TwiML",
  );
  assert(
    (await emptyMessagingResponse().text()).includes("<Response></Response>"),
    "empty TwiML mismatch",
  );
});

Deno.test("SMS splitting is bounded and lossless modulo boundary whitespace", () => {
  const input = "First sentence. " + "word ".repeat(120) +
    "https://example.test/path";
  const chunks = splitSmsText(input, 180);
  assert(chunks.length > 1, "text was not split");
  assert(chunks.every((chunk) => chunk.length <= 180), "oversized chunk");
  assert(
    chunks.join(" ").replace(/\s+/g, " ") === input.trim().replace(/\s+/g, " "),
    "content changed",
  );
});

Deno.test("phone normalization, hashing, and redaction avoid raw identifiers", async () => {
  assert(
    normalizePhone("+14165551212") === "+14165551212",
    "valid phone rejected",
  );
  let rejected = false;
  try {
    normalizePhone("416-555-1212");
  } catch {
    rejected = true;
  }
  assert(rejected, "non-E.164 phone accepted");
  const first = await hashPhone(
    "+14165551212",
    "a-test-pepper-at-least-16-chars",
  );
  const second = await hashPhone(
    "+14165551212",
    "a-test-pepper-at-least-16-chars",
  );
  assert(
    first === second && !first.includes("4165551212"),
    "unsafe/unstable phone hash",
  );
  assert(redactPhone("+14165551212") === "***1212", "redaction mismatch");
});

Deno.test("SMS queue admission uses only the deployed RPC contract", () => {
  const input = smsWorkAcceptanceInput({
    messageSid: "SM1234567890123456",
    userId: "a4b78c86-a000-485c-b161-7c747d0c728e",
    surfaceConversationId: "sms:number:tohash:fromhash",
  });
  const expected = [
    "p_consumer_version",
    "p_conversation_id",
    "p_execution_generation",
    "p_idempotency_key",
    "p_payload",
    "p_payload_ref",
    "p_priority",
    "p_request_type",
    "p_resource_key",
    "p_resource_type",
    "p_route",
    "p_source_event_id",
    "p_source_surface",
    "p_user_id",
  ];
  assert(
    JSON.stringify(Object.keys(input).sort()) === JSON.stringify(expected),
    "queue admission drifted from accept_linkr_work_item",
  );
});
