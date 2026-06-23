/**
 * Trwałe przechowywanie plików audio (natywnie). Nagranie powstaje w cache (useAudioCapture);
 * tu przenosimy je do documentDirectory/recordings/<id>.aac, żeby OS nie skasował cache.
 *
 * Używamy `expo-file-system/legacy` (operacje na surowych uri), bo nowy File API v56 ma
 * scoped-permissions i ODRZUCA dostęp do uri nagrania z expo-audio ("Missing 'READ' permission").
 * Wariant .web.ts to no-op (na web brak realnych plików — nagranie to mock bez uri).
 */
import * as FileSystem from 'expo-file-system/legacy';

const DIR = (FileSystem.documentDirectory ?? '') + 'recordings/';

/** Przenieś nagrany plik z cache do trwałego katalogu. Zwraca finalne uri + rozmiar. */
export async function persistRecording(cacheUri: string, id: string): Promise<{ uri: string; sizeBytes?: number }> {
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  } catch {}
  const dest = DIR + id + '.aac';
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true }); // nadpisanie (id unikalne; to zabezpieczenie)
  } catch {}
  await FileSystem.moveAsync({ from: cacheUri, to: dest });
  let sizeBytes: number | undefined;
  try {
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists && info.size > 0) sizeBytes = info.size;
  } catch {}
  return { uri: dest, sizeBytes };
}

/** Skasuj plik nagrania (np. przy GC osieroconych). */
export async function deleteRecordingFile(uri?: string): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

/**
 * GC: usuń pliki, których id nie ma już w bazie (osierocone po usunięciu nagrania).
 * Wołane przy starcie — dlatego usuwanie nagrania NIE kasuje pliku od razu (UNDO zachowuje audio
 * w tej samej sesji; realne sprzątanie przy następnym starcie).
 */
export async function cleanupOrphanFiles(validIds: string[]): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) return;
    const keep = new Set(validIds.map((id) => id + '.aac'));
    const names = await FileSystem.readDirectoryAsync(DIR);
    for (const name of names) {
      if (!keep.has(name)) {
        try {
          await FileSystem.deleteAsync(DIR + name, { idempotent: true });
        } catch {}
      }
    }
  } catch {}
}
