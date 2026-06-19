/**
 * Display — "ekran" dyktafonu. To SLOT NA TREŚĆ: cały content aplikacji
 * (transkrypcja, historia, ustawienia...) renderuje się tu jako children.
 * Obudowa wokół jest stała. Tu odwzorowana sama szyba: ramka + połysk + glow.
 */
import { ReactNode } from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { color, dims, gradient, shadow } from '../../theme/tokens';
import { useTiltCtx } from '../../theme/TiltContext';

/** Miękka poświata zza lewego-górnego rogu szyby; delikatnie pływa (parallax, górna część). */
function Glow() {
  const tilt = useTiltCtx();
  const transform = tilt
    ? [
        { translateX: tilt.tx.interpolate({ inputRange: [-1, 1], outputRange: [-18, 18] }) },
        { translateY: tilt.ty.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
      ]
    : undefined;
  // jasność poświaty rośnie z wychyleniem (obie osie) — efekt akcelerometru staje się widoczny:
  // spoczynek ~0.45, pełne wychylenie 1.0. Bez tiltu (motion off) statycznie 0.45.
  const mag = tilt
    ? Animated.add(
        tilt.tx.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1] }),
        tilt.ty.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1] })
      )
    : null;
  const opacity = mag ? mag.interpolate({ inputRange: [0, 2], outputRange: [0.45, 1], extrapolate: 'clamp' }) : 0.45;
  return (
    <Animated.View
      // overscan ±24 (> ±18 przesuwu) → poświata nie odsłania krawędzi przy parallaksie
      style={{ position: 'absolute', top: -24, bottom: -24, left: -24, right: -24, pointerEvents: 'none', opacity, transform } as any}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="screenGlow" cx="22%" cy="14%" r="80%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#screenGlow)" />
      </Svg>
    </Animated.View>
  );
}

/** Połysk szyby — biały gradient TL→BR; górny node sunie po górnej krawędzi, dolny po dolnej. */
function Sheen() {
  const tilt = useTiltCtx();
  const sheenX = tilt ? tilt.tx.interpolate({ inputRange: [-1, 1], outputRange: [-44, 44] }) : 0;
  // jasność połysku rośnie z wychyleniem w poziomie: spoczynek 0.16, pełny tilt 0.34
  const opacity = tilt ? tilt.tx.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.34, 0.16, 0.34] }) : 0.16;
  return (
    <Animated.View
      // poszerzony box (±56 > ±44 przesuwu) → przesuw nie odsłania krawędzi; clip robi overflow szyby
      style={
        {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -56,
          right: -56,
          opacity,
          transform: [{ translateX: sheenX }],
        } as any
      }
      pointerEvents="none"
    >
      <LinearGradient
        colors={gradient.screenSheen.colors}
        start={gradient.screenSheen.start}
        end={gradient.screenSheen.end}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

export function Display({ children }: { children?: ReactNode }) {
  return (
    // screen_frame — ciemna ramka wokół szyby (padding 2, darkSurface)
    <LinearGradient
      colors={gradient.darkSurface.colors}
      start={gradient.darkSurface.start}
      end={gradient.darkSurface.end}
      style={{ flex: 1, alignSelf: 'stretch', padding: dims.screenFramePadding }}
    >
      {/* screen — szyba: tło #1A1A1A + połysk + inset shadow */}
      <View
        style={{
          flex: 1,
          borderRadius: dims.screenRadius,
          backgroundColor: color.dark1A,
          overflow: 'hidden',
          boxShadow: shadow.screenInset,
        }}
      >
        {/* SLOT NA TREŚĆ — POD połyskiem/poświatą */}
        <View
          style={{
            position: 'absolute',
            inset: 0,
            padding: dims.screenPadding,
            gap: dims.screenGap,
          }}
        >
          {children}
        </View>
        {/* połysk + poświata ZAWSZE NAD treścią (pointerEvents none → nie blokują dotyku) */}
        <Sheen />
        <Glow />
      </View>
    </LinearGradient>
  );
}
