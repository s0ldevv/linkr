import { serializeUnknownError } from "./http.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

Deno.test("serializeUnknownError preserves structured database diagnostics", () => {
  assertEquals(
    serializeUnknownError({
      message: 'record "new" has no field "pending_action_id"',
      code: "42703",
      details: "PL/pgSQL function set_action_source_surface()",
      hint: null,
    }),
    {
      message: 'record "new" has no field "pending_action_id"',
      code: "42703",
      details: "PL/pgSQL function set_action_source_surface()",
    },
    "database error fields should be retained",
  );
});

Deno.test("serializeUnknownError handles Error and primitive values", () => {
  assertEquals(
    serializeUnknownError(new TypeError("missing run")),
    { name: "TypeError", message: "missing run" },
    "Error details should be retained",
  );
  assertEquals(
    serializeUnknownError("failure"),
    { message: "failure" },
    "primitive errors should remain readable",
  );
});
