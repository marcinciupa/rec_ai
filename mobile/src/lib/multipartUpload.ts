/**
 * Upload multipart (natywnie) przez `expo-file-system/legacy` `uploadAsync` — natywny upload pliku
 * z surowego uri (file://). Wybrane ŚWIADOMIE zamiast nowego File/fetch, bo:
 *  - nowy `File` API v56 ma scoped-permissions i ODRZUCA dostęp do uri nagrania z expo-audio
 *    ("Missing 'READ' permission"),
 *  - legacy `{uri,name,type}` w RN FormData nie działa na New Architecture ("Unsupported FormDataPart").
 * Legacy uploadAsync omija oba problemy (czyta uri natywnie, buduje multipart sam).
 */
import * as FileSystem from 'expo-file-system/legacy';

export type UploadResult = { status: number; text: string };

export async function uploadMultipart(opts: {
  url: string;
  fileUri: string;
  fieldName: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<UploadResult> {
  const res = await FileSystem.uploadAsync(opts.url, opts.fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: opts.fieldName,
    mimeType: 'audio/aac',
    parameters: opts.fields,
    headers: opts.headers,
  });
  return { status: res.status, text: res.body };
}
