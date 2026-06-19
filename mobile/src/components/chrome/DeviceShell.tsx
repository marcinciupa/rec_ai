/**
 * DeviceShell — obudowa dyktafonu (stała rama). Składa wszystkie elementy
 * w jednym z dwóch wariantów. `children` trafia "w ekran" jako treść aplikacji.
 *
 *  body
 *   ├─ UpperMic            (device: logo+grille+REC | fullscreen: pusty pas)
 *   ├─ interaction_area
 *   │   ├─ Display (slot)  ← treść aplikacji
 *   │   ├─ SeekSlider
 *   │   └─ Keyboard
 *   └─ LowerMic
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, View, PanResponder, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { dims, gradient, themes, ThemeName } from '../../theme/tokens';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext';
import { TiltProvider } from '../../theme/TiltContext';
import { BlinkProvider } from '../../theme/BlinkContext';
import { useTilt } from '../../hooks/useTilt';
import { UpperMic, LowerMic } from './Mic';
import { Display } from './Display';
import { SeekSlider, SliderConfig } from './SeekSlider';
import { Keyboard, KeyboardConfig } from './Keyboard';

export type Variant = 'device' | 'fullscreen';

const TEXTURE = require('../../../assets/figma/body_texture.png');

// Bevel obudowy — kolory UNIWERSALNE (jak wszystkie bevele w apce: white25%/dark25%,
// gradient.bodyStroke = RAISED). Theme-robust: na jasnej obudowie widać krawędź cienia,
// na ciemnej krawędź światła; spójne z klawiszami/gril­lem (NIE hardcode solid white, który
// na jasnym motywie dawał mocną białą linię i nie wpisywał się w system bevela).
const CASING_BEVEL_LIGHT = gradient.bodyStroke.colors[0];
const CASING_BEVEL_SHADOW = gradient.bodyStroke.colors[1];

function Body({
  variant,
  recording,
  muted,
  motion,
  keyboard,
  slider,
  onPinch,
  children,
}: {
  variant: Variant;
  recording?: boolean;
  muted?: boolean;
  motion?: boolean;
  keyboard?: KeyboardConfig;
  slider?: SliderConfig;
  onPinch?: (dir: 'in' | 'out') => void;
  children?: ReactNode;
}) {
  const { bodyMetal } = useTheme();
  const { tx, ty } = useTilt(!!motion);
  const tiltValue = useMemo(() => ({ tx, ty }), [tx, ty]);

  // GEST PINCH: rozsunięcie 2 palców → fullscreen ('out'), zsunięcie → device ('in').
  const onPinchRef = useRef(onPinch);
  onPinchRef.current = onPinch;
  const pinchStart = useRef<number | null>(null);
  const pinchFired = useRef(false);
  const touchDist = (touches: any[]) => Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  const pinch = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderMove: (e) => {
        const ts = e.nativeEvent.touches;
        if (ts.length !== 2) return;
        const d = touchDist(ts as any[]);
        if (pinchStart.current == null) {
          pinchStart.current = d;
          pinchFired.current = false;
          return;
        }
        if (pinchFired.current) return;
        const ratio = d / pinchStart.current;
        if (ratio > 1.25) {
          pinchFired.current = true;
          onPinchRef.current?.('out');
        } else if (ratio < 0.8) {
          pinchFired.current = true;
          onPinchRef.current?.('in');
        }
      },
      onPanResponderRelease: () => {
        pinchStart.current = null;
      },
      onPanResponderTerminate: () => {
        pinchStart.current = null;
      },
    })
  ).current;
  // web (trackpad): pinch = wheel z ctrlKey; deltaY<0 (rozsuwanie) → fullscreen, >0 → device.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let last = 0;
    const onWheel = (e: any) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      onPinchRef.current?.(e.deltaY < 0 ? 'out' : 'in');
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  // tekstura: delikatny parallax tylko w poziomie (cover ma duży zapas po bokach → brak krawędzi)
  const texShift = tx.interpolate({ inputRange: [-1, 1], outputRange: [-16, 16] });
  // device_view: zaokrąglona obudowa-gadżet. fullscreen: kwadratowe rogi, edge-to-edge (jak w Figmie).
  const radius =
    variant === 'device'
      ? {
          borderTopLeftRadius: dims.bodyRadius.tl,
          borderTopRightRadius: dims.bodyRadius.tr,
          borderBottomRightRadius: dims.bodyRadius.br,
          borderBottomLeftRadius: dims.bodyRadius.bl,
        }
      : null;
  // Bevel obudowy = DWIE sekcje (jak w Figmie 235:6669-6673): górna (pas mikrofonu) i dolna
  // (slider+klawiatura+dolny mic). Środek (ekran) BEZ bocznych obrysów → bevel widoczny na
  // bokach OBUDOWY, ale nie przy ekranie; ekran od krawędzi do krawędzi. Wysokości mierzymy
  // (micH = górny pas, screenH = szyba) — reszta to sekcja dolna.
  const [micH, setMicH] = useState(0);
  const [screenH, setScreenH] = useState(0);
  return (
    <BlinkProvider active={!!recording}>
    <TiltProvider value={tiltValue}>
    <View
      {...pinch.panHandlers}
      style={{
        flex: 1,
        ...radius,
        overflow: 'hidden',
      }}
    >
      {/* metal: gradient bazowy + tekstura brushed-metal */}
      <LinearGradient
        colors={bodyMetal.colors}
        start={bodyMetal.start}
        end={bodyMetal.end}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* brushed-metal: tekstura szczotkowanego metalu na gradiencie (fill_XTLYT6).
          WAŻNE: wrapper to View (nie Image) — View bez intrinsic size stretchuje się na pełną
          wysokość obudowy (top/bottom:0). RNW Image dostaje intrinsic height obrazka (360px),
          co NADPISUJE bottom:0 → tekstura pokrywała tylko górę. Image w środku = 100%×100% cover.
          opacity reguluje siłę szczotki; parallax (translateX z useTilt) na wrapperze. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          // overscan ±24 po bokach (> ±16 przesuwu) → parallax nie odsłania krawędzi tekstury
          top: 0,
          bottom: 0,
          left: -24,
          right: -24,
          // blend + opacity NA WRAPPERZE: wrapper ma transform (stacking context), więc blend
          // dziecka byłby izolowany do wnętrza wrappera (= overlay z niczym → za jasno).
          // Na wrapperze grupa miesza się z gradientem ZA nim. (gotcha RNW/CSS blend)
          opacity: 0.5,
          mixBlendMode: 'overlay',
          transform: [{ translateX: texShift }],
        } as any}
      >
        <Image
          source={TEXTURE}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>
      {/* pas mikrofonu (górna sekcja) — mierzymy wysokość dla górnego bevela */}
      <View
        style={{ alignSelf: 'stretch' }}
        onLayout={(e) => setMicH(e.nativeEvent.layout.height)}
      >
        <UpperMic variant={variant} recording={recording} muted={muted} />
      </View>
      {/* interaction_area */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}>
        {/* szyba — mierzymy wysokość, żeby wiedzieć gdzie kończy się ekran (start dolnej sekcji) */}
        <View
          style={{ flex: 1, alignSelf: 'stretch' }}
          onLayout={(e) => setScreenH(e.nativeEvent.layout.height)}
        >
          <Display>{children}</Display>
        </View>
        <SeekSlider config={slider} />
        <Keyboard config={keyboard} />
      </View>
      <LowerMic />
      {/* BEVEL OBUDOWY (Figma 160:2195 stroke-light/stroke-shadow). micH = pas górny, screenH = szyba.
          Guard tylko na screenH (w fullscreen na web micH=0 — brak statusbara — a linie i tak mają być). */}
      {screenH > 0 && (
        <>
          {/* RECESS — ekran wpuszczony: cień NAD ekranem, światło POD ekranem. W OBU wariantach
              (też fullscreen). Kolory uniwersalne (theme-robust) → „podpięte pod motywy". */}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: micH, height: 1, backgroundColor: CASING_BEVEL_SHADOW }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: micH + screenH - 1, height: 1, backgroundColor: CASING_BEVEL_LIGHT }} />
          {/* BOK + rogi obudowy — tylko device_view (fullscreen = edge-to-edge, bez boków) */}
          {variant === 'device' && (
            <>
              {/* górna sekcja (mic): światło góra+lewo, cień prawo */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: micH,
                  borderTopLeftRadius: dims.bodyRadius.tl,
                  borderTopRightRadius: dims.bodyRadius.tr,
                  borderTopWidth: 1,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderTopColor: CASING_BEVEL_LIGHT,
                  borderLeftColor: CASING_BEVEL_LIGHT,
                  borderRightColor: CASING_BEVEL_SHADOW,
                }}
              />
              {/* dolna sekcja (slider+klawiatura+dolny mic): cień prawo+dół */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: micH + screenH,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderBottomLeftRadius: dims.bodyRadius.bl,
                  borderBottomRightRadius: dims.bodyRadius.br,
                  borderRightWidth: 1,
                  borderBottomWidth: 1,
                  borderRightColor: CASING_BEVEL_SHADOW,
                  borderBottomColor: CASING_BEVEL_SHADOW,
                }}
              />
            </>
          )}
        </>
      )}
    </View>
    </TiltProvider>
    </BlinkProvider>
  );
}

export function DeviceShell({
  variant = 'device',
  recording = false,
  muted = false,
  theme = 'LIGHT',
  motion = false,
  keyboard,
  slider,
  onPinch,
  children,
}: {
  variant?: Variant;
  recording?: boolean;
  muted?: boolean;
  theme?: ThemeName;
  motion?: boolean;
  keyboard?: KeyboardConfig;
  slider?: SliderConfig;
  onPinch?: (dir: 'in' | 'out') => void;
  children?: ReactNode;
}) {
  if (variant === 'fullscreen') {
    // edge-to-edge: tło sięga POD statusbar (oś Z), bez paddingu spychającego treść w dół.
    // Górny pas „mic" (czoło) dostaje wysokość = statusbar (w UpperMic), więc leży ZA ikonami,
    // a ekran zaczyna się tuż pod nimi.
    return (
      <ThemeProvider value={themes[theme]}>
        <LinearGradient
          colors={gradient.appBg.colors}
          start={gradient.appBg.start}
          end={gradient.appBg.end}
          style={{ flex: 1 }}
        >
          <Body
            variant="fullscreen"
            recording={recording}
            muted={muted}
            motion={motion}
            keyboard={keyboard}
            slider={slider}
            onPinch={onPinch}
          >
            {children}
          </Body>
        </LinearGradient>
      </ThemeProvider>
    );
  }

  // device_view — urządzenie-gadżet z marginesami (bez mockowego paska statusu)
  return (
    <ThemeProvider value={themes[theme]}>
      {/* tło za urządzeniem: pełna czerń (#000000) */}
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <View style={{ flex: 1, padding: 8 }}>
          <Body
            variant="device"
            recording={recording}
            muted={muted}
            motion={motion}
            keyboard={keyboard}
            slider={slider}
            onPinch={onPinch}
          >
            {children}
          </Body>
        </View>
      </View>
    </ThemeProvider>
  );
}
