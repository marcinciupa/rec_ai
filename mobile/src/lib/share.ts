// Udostępnianie nagrania audio przez natywny arkusz systemowy (expo-sharing).
import * as Sharing from 'expo-sharing';

export async function shareRecording(uri?: string, name?: string): Promise<void> {
  if (!uri) return;
  try {
    if (!(await Sharing.isAvailableAsync())) return;
    const ext = uri.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
    await Sharing.shareAsync(uri, {
      mimeType: ext === '.aac' ? 'audio/aac' : 'audio/mp4', // m4a (MPEG-4/AAC) teraz / aac (ADTS) dawne
      dialogTitle: name ? `Share ${name}` : 'Share recording',
      UTI: 'public.audio', // iOS
    });
  } catch {
    // user anulował arkusz albo brak handlera — cicho ignorujemy
  }
}
