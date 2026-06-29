// Udostępnianie nagrania audio przez natywny arkusz systemowy (expo-sharing).
import * as Sharing from 'expo-sharing';

export async function shareRecording(uri?: string, name?: string): Promise<void> {
  if (!uri) return;
  try {
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(uri, {
      mimeType: 'audio/aac', // format nagrań apki (AAC ADTS)
      dialogTitle: name ? `Share ${name}` : 'Share recording',
      UTI: 'public.audio', // iOS
    });
  } catch {
    // user anulował arkusz albo brak handlera — cicho ignorujemy
  }
}
