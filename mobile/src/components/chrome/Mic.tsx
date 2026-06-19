/**
 * UpperMic / LowerMic — pasy mikrofonu (grille).
 * device_view: górny pas z logo + grille + diodą REC.
 * fullscreen_view: górny pas pusty (cienki 40px), dolny grille w obu.
 */
import { useState } from 'react';
import { View, LayoutChangeEvent, Platform, StatusBar as RNStatusBar } from 'react-native';
import { dims } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { useBlink } from '../../theme/BlinkContext';
import { MicGrille } from './primitives';
import { LogoIcon, LedIcon } from '../icons';
import type { Variant } from './DeviceShell';

/**
 * Grille mierzący dostępną szerokość i renderujący wyśrodkowany rząd kropek.
 * `fraction` ogranicza pasmo kropek do części szerokości (lower_mic = ~0.6 jak w Figmie).
 */
function FillGrille({ rows = 1, fraction = 1 }: { rows?: number; fraction?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.floor(e.nativeEvent.layout.width));
  const band = Math.floor(w * fraction);
  return (
    <View style={{ flex: 1, overflow: 'hidden', alignItems: 'center' }} onLayout={onLayout}>
      {band > 8 ? <MicGrille width={band} rows={rows} /> : null}
    </View>
  );
}

export function UpperMic({
  variant,
  recording = false,
  muted = false,
}: {
  variant: Variant;
  recording?: boolean;
  muted?: boolean;
}) {
  const t = useTheme();
  const blinkOn = useBlink();
  // dioda: podczas nagrywania miga (1s); w mute świeci statycznie (blink przejmuje baner MUTED)
  const ledOn = recording && (muted || blinkOn);
  if (variant === 'fullscreen') {
    // czoło = pas o wysokości statusbara (Android runtime); leży ZA ikonami statusbara (oś Z),
    // dzięki czemu ekran startuje tuż pod nimi. Web/iOS: brak statusbara → 0.
    const sbH = Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0;
    return <View style={{ height: sbH, alignSelf: 'stretch' }} />;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignSelf: 'stretch',
      }}
    >
      <LogoIcon size={12} fill={t.printed} />
      <FillGrille rows={1} />
      {/* led wielkości kropki grille (4×4 w Figmie) — obrys wg motywu (jak otwory) */}
      <LedIcon
        size={5}
        recording={ledOn}
        strokeFrom={t.recessedBevel.colors[0]}
        strokeTo={t.recessedBevel.colors[1]}
      />
    </View>
  );
}

export function LowerMic() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignSelf: 'stretch',
      }}
    >
      {/* pojedynczy, wyśrodkowany rząd kropek (~60% szerokości — jak lower_mic.svg) */}
      <FillGrille rows={1} fraction={0.6} />
    </View>
  );
}
