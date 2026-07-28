const SECRET_FIELD =
  /(?:secret|token|authorization|private.?key|signed.?transaction|credential|password)/i;

export function sanitizedFields(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      result[key] = "[redacted]";
    } else if (typeof item === "string") {
      result[key] = item.slice(0, 500);
    } else if (
      item === null || typeof item === "number" || typeof item === "boolean"
    ) {
      result[key] = item;
    } else if (Array.isArray(item)) {
      result[key] = { count: item.length };
    } else if (typeof item === "object") {
      result[key] = "[object]";
    }
  }
  return result;
}

export function logOperationalEvent(
  event: string,
  fields: Record<string, unknown>,
) {
  console.log(
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...sanitizedFields(fields),
    }),
  );
}
