/**
 * usePlayer (natywny) — realny odtwarzacz pliku (expo-audio). Wariant .web.ts to no-op stub,
 * dzięki czemu web NIE importuje expo-audio (które na web wywala expo-asset).
 */
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export function usePlayer() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  return { player, status };
}
