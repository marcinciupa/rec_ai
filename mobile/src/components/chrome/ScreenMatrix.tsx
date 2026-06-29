/**
 * ScreenMatrix — nakładka „matryca ekranu" (Figma 121:269, warstwa „matrix"): kafelkowany PNG
 * symulujący siatkę pikseli wyświetlacza. Tekstura ma alfę (ciemne piksele ~10–25% + przezroczyste
 * oczka), więc nakładana zwykłym alpha (bez blendingu) — delikatnie przyciemnia, dając matrycę.
 * Kafel 16px skalowany ×SCALE (Figma scaleMode TILE, scalingFactor 0.25) — repeat na powiększonej warstwie (100/SCALE %)
 * z transformem SCALE daje kafel docelowego rozmiaru, bez sztuczek z gęstością assetu.
 * Renderowana MIĘDZY treścią a połyskiem/glow. Dotyczy ekranów i screen-buttonów; NIE metalowych klawiszy.
 */
import { Image, View } from 'react-native';

const MATRIX = require('../../../assets/figma/screen_matrix.png');
const SCALE = 0.25; // skala kafla matrycy

export function ScreenMatrix({ radius }: { radius?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' } as any}>
      <Image
        source={MATRIX}
        resizeMode="repeat"
        style={{ position: 'absolute', top: 0, left: 0, width: `${100 / SCALE}%`, height: `${100 / SCALE}%`, transform: [{ scale: SCALE }], transformOrigin: 'top left' } as any}
      />
    </View>
  );
}
