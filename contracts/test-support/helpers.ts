import assert from "node:assert/strict";

function collectRevertData(error: unknown): string[] {
  const data: string[] = [];
  const seen = new Set<object>();

  function visit(value: unknown, depth: number) {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of ["data", "returnData"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.startsWith("0x")) {
        data.push(candidate);
      } else {
        visit(candidate, depth + 1);
      }
    }

    for (const key of ["error", "info", "cause", "payload", "body"]) {
      visit(record[key], depth + 1);
    }
  }

  visit(error, 0);
  return data;
}

export async function assertCustomError(promise: Promise<unknown>, contract: any, errorName: string) {
  await assert.rejects(
    promise,
    (error: unknown) => {
      for (const data of collectRevertData(error)) {
        try {
          if (contract.interface.parseError(data)?.name === errorName) return true;
        } catch {
          // Try the next data field or fall back to the error text.
        }
      }
      return String((error as Error)?.message ?? error).includes(errorName);
    },
    `Expected custom error ${errorName}`,
  );
}

export async function assertRevertReason(promise: Promise<unknown>, reason: string) {
  await assert.rejects(
    promise,
    (error: unknown) => String((error as Error)?.message ?? error).includes(reason),
    `Expected revert reason ${reason}`,
  );
}

export async function assertReverts(promise: Promise<unknown>) {
  await assert.rejects(promise);
}
