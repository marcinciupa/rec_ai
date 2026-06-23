/** Upload multipart na web — standardowy fetch+FormData. (Web nie nagrywa audio, więc realnie nieużywane.) */
export type UploadResult = { status: number; text: string };

export async function uploadMultipart(opts: {
  url: string;
  fileUri: string;
  fieldName: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<UploadResult> {
  const form = new FormData();
  try {
    const blob = await (await fetch(opts.fileUri)).blob(); // np. blob:/data: URL
    form.append(opts.fieldName, blob);
  } catch {
    form.append(opts.fieldName, opts.fileUri);
  }
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) form.append(k, v);
  }
  const res = await fetch(opts.url, { method: 'POST', headers: opts.headers, body: form });
  return { status: res.status, text: await res.text() };
}
