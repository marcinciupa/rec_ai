/** Pliki nagrań na web — no-op (brak realnych plików; nagranie na web to mock bez uri). Interfejs jak recordingFiles.ts. */
export async function persistRecording(cacheUri: string, _id: string): Promise<{ uri: string; sizeBytes?: number }> {
  return { uri: cacheUri };
}

export async function deleteRecordingFile(_uri?: string): Promise<void> {}

export async function cleanupOrphanFiles(_validIds: string[]): Promise<void> {}
