// deno-lint-ignore-file no-explicit-any

export async function indexMemory(
  admin: any,
  userId: string,
  sourceType: string,
  sourceId: string,
  title: string,
  text: string,
  metadata: any = {},
) {
  if (!userId || !sourceType || !sourceId || !text) return;

  await admin.from("user_memory_index").insert({
    user_id: userId,
    source_type: sourceType,
    source_id: sourceId,
    title,
    searchable_text: text.slice(0, 3000),
    metadata,
  });
}
