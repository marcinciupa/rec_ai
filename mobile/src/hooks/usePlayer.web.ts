/**
 * usePlayer (web) — stub no-op. Na web nie ma realnych nagrań (uri), więc player nie jest używany;
 * unikamy importu expo-audio/expo-asset, który na web rzuca „Cannot find native module 'ExpoAsset'".
 */
export function usePlayer() {
  const player = {
    replace: (_src?: any) => {},
    play: () => {},
    pause: () => {},
    seekTo: (_s: number) => {},
    setPlaybackRate: (_r: number) => {},
  };
  const status = { playing: false, currentTime: 0, duration: 0, isLoaded: false, isBuffering: false, didJustFinish: false };
  return { player, status };
}
