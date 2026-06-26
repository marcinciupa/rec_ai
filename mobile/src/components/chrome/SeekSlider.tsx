/**
 * SeekSlider — pas przewijania. Kontekstowy: `config` (SliderConfig) decyduje czy
 * jest "podświetlony" (aktywny w danym ekranie) i podpina akcje:
 *   prev/next  → wybór elementu listy (góra/dół)
 *   knob       → wychylenie od pozycji 0: w prawo następna opcja, w lewo poprzednia
 * Bez configu → wariant nieaktywny (przygaszony, bez interakcji), jak w nagrywaniu.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, PanResponder, LayoutChangeEvent } from 'react-native';
import { dims, font, gradient, shadow, knobShadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { Bevel } from './primitives';
import { ClickedDim } from './KeyButton';
import { hapticPress, hapticRelease, hapticShort, hapticKnob, hapticKnobReturn } from '../../lib/haptics';
import { RewindBackIcon, RewindFwdIcon, SeekArrowIcon } from '../icons';

/** Konfiguracja slidera dla danego ekranu. */
export type SliderConfig = {
  highlighted?: boolean;
  /** dyskretny (ustawienia): zmiana o krok przy 10% wychylenia + pojedynczy impuls, bez narastania. */
  discrete?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onAdjust?: (dir: -1 | 1) => void;
  /** ciągły scrub (playback): wywoływany co ~100ms gdy knob wychylony; rate = -1..1 (znak=kierunek). */
  onScrub?: (rate: number) => void;
  /** koniec scrubu (puszczenie knoba) — np. wznowienie odtwarzania po przewijaniu. */
  onScrubEnd?: () => void;
};

/** Mały przycisk seek (button_gap → button_small → ikona). Podświetlony = białe ikony. */
function SeekButton({
  dir,
  highlighted,
  onPress,
}: {
  dir: 'back' | 'fwd';
  highlighted?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  // podświetlenie wg motywu (jak klawisze): t.buttonActive (biały na LIGHT/DARK, bursztyn ORANGE, błękit NAVY)
  const iconFill = highlighted ? t.buttonActive : t.printed;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPress ? hapticPress : hapticShort}
      onPressOut={onPress ? hapticRelease : hapticShort}
      hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
    >
      {({ pressed }) => (
        // nakładka clicked NAD całym przyciskiem (kieszeń + obrys), nie tylko wewnętrzny
        <View>
          <Bevel
            stroke={t.pocketBevel}
            width={1}
            radius={6}
            fillGradient={gradient.darkSurface}
            innerStyle={{ padding: 2 }}
          >
            <View style={{ width: dims.smallButton.width, height: dims.smallButton.height }}>
              <Bevel
                stroke={t.raisedBevel}
                width={1}
                radius={dims.smallButton.radius}
                fill={t.metal}
                style={{ flex: 1 }}
                innerStyle={{ alignItems: 'center', justifyContent: 'center' }}
              >
                {dir === 'back' ? (
                  <RewindBackIcon width={16} fill={iconFill} />
                ) : (
                  <RewindFwdIcon width={16} fill={iconFill} />
                )}
              </Bevel>
            </View>
          </Bevel>
          {pressed ? <ClickedDim radius={6} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Etykieta prędkości "10X" ze strzałką kierunku. Nadruk na obudowie — kolor wg motywu. */
function SpeedLabel({ dir }: { dir: 'left' | 'right' }) {
  const t = useTheme();
  const arrow = <SeekArrowIcon size={12} dir={dir} fill={t.printed} />;
  const label = (
    <Text style={{ fontFamily: font.uiLabel.family, fontSize: font.uiLabel.size, color: t.printed }}>
      10X
    </Text>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {dir === 'left' ? arrow : label}
      {dir === 'left' ? label : arrow}
    </View>
  );
}

const KNOB_THRESHOLD = 16; // próg wychylenia, po którym (w trybie discrete) zmieniamy parametr

/**
 * Knob z trzema liniami uchwytu. Przeciągany od środka aż do końca groove (maxTravel).
 * Tryb discrete (settings): po przekroczeniu progu wywołuje onAdjust(±1) raz, wraca na 0.
 * (Tryb prędkościowy do przewijania — proporcjonalny do wychylenia — dorobimy przy nagrywaniu.)
 */
function Knob({
  highlighted,
  onAdjust,
  onScrub,
  onScrubEnd,
  maxTravel,
  discrete = false,
}: {
  highlighted?: boolean;
  onAdjust?: (dir: -1 | 1) => void;
  onScrub?: (rate: number) => void;
  onScrubEnd?: () => void;
  maxTravel: number;
  discrete?: boolean;
}) {
  const t = useTheme();
  const tx = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  const lastHaptic = useRef(0);
  const adjustRef = useRef(onAdjust);
  adjustRef.current = onAdjust;
  const scrubRef = useRef(onScrub);
  scrubRef.current = onScrub;
  const scrubEndRef = useRef(onScrubEnd);
  scrubEndRef.current = onScrubEnd;
  const maxRef = useRef(maxTravel);
  maxRef.current = maxTravel;
  const discreteRef = useRef(discrete); // ref: PanResponder tworzony raz, prop discrete byłby stale
  discreteRef.current = discrete;
  const ratioRef = useRef(0); // aktualne wychylenie -1..1 (dla scruba)
  const scrubTimer = useRef<any>(null);

  useEffect(() => () => clearInterval(scrubTimer.current), []);

  const springBack = () => {
    fired.current = false;
    clearInterval(scrubTimer.current); // zatrzymaj scrub
    ratioRef.current = 0;
    if (scrubRef.current) {
      scrubEndRef.current?.(); // koniec scrubu (wznowienie + zgaszenie ciągłej wibracji robi ekran)
      // knob fizycznie sprężynuje na środek; krótka wibracja DOPIERO gdy dotrze do punktu 0
      Animated.spring(tx, { toValue: 0, useNativeDriver: false }).start(({ finished }) => {
        if (finished) hapticShort();
      });
      return;
    }
    // klik na powrót do 0 (też nieaktywny knob): aktywny=podwójny tick, nieaktywny=pojedynczy (jak klawiatura)
    hapticKnobReturn(!!adjustRef.current);
    Animated.spring(tx, { toValue: 0, useNativeDriver: false }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // knob to pseudofizyczny obiekt — zawsze daje się wychylić (sprężynuje); efekt tylko gdy onAdjust/onScrub
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderGrant: () => {
        // scrub: dopóki knob wychylony (trzymany), wywołuj onScrub(rate) co 100 ms
        if (scrubRef.current) {
          clearInterval(scrubTimer.current);
          scrubTimer.current = setInterval(() => scrubRef.current?.(ratioRef.current), 100);
        }
      },
      onPanResponderMove: (_e, g) => {
        const max = maxRef.current || 0;
        const clamped = Math.max(-max, Math.min(max, g.dx));
        tx.setValue(clamped);
        ratioRef.current = max > 0 ? clamped / max : 0;
        const isScrub = !!scrubRef.current;
        const isDiscrete = discreteRef.current;
        // haptyka knoba tylko dla starego trybu ciągłego-adjust; scrub (playback) ma własną haptykę w ekranie
        if (!isScrub && !isDiscrete && adjustRef.current && max > 0) {
          const now = Date.now();
          if (now - lastHaptic.current > 45) {
            lastHaptic.current = now;
            const ratio = Math.min(1, Math.abs(clamped) / max);
            if (ratio > 0.05) hapticKnob(ratio);
          }
        }
        // tryby krokowe (onAdjust): discrete = 10% wychylenia, ciągły-stary = stały próg
        if (!isScrub && !fired.current) {
          const threshold = isDiscrete ? 0.1 * max : KNOB_THRESHOLD;
          if (Math.abs(g.dx) > threshold) {
            fired.current = true;
            adjustRef.current?.(g.dx > 0 ? 1 : -1);
            if (isDiscrete && adjustRef.current) hapticKnob(0.5); // krótki impuls na zmianie
          }
        }
      },
      onPanResponderRelease: springBack,
      onPanResponderTerminate: springBack,
    })
  ).current;

  const gripColor = highlighted ? t.buttonActive : t.printed;
  return (
    <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
      <Bevel
        stroke={t.raisedBevel}
        width={1}
        radius={dims.knob.radius}
        fill={t.metal}
        style={{
          width: dims.knob.width,
          height: dims.knob.height,
          boxShadow: knobShadow(t),
        }}
        innerStyle={{
          flexDirection: 'row',
          alignItems: 'stretch',
          justifyContent: 'center',
          gap: 2,
          paddingHorizontal: 24,
          paddingVertical: 4,
        }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{ flex: 1, borderRadius: 2, backgroundColor: gripColor, boxShadow: shadow.knobGripInset }}
          />
        ))}
      </Bevel>
    </Animated.View>
  );
}

/**
 * Rowek (groove): ciemny pasek + bevel wklęsły (recessedBevel wg motywu).
 * Ciągły na całą szerokość, biegnie POD knobem.
 */
function Track() {
  const t = useTheme();
  return (
    <Bevel
      stroke={t.recessedBevel}
      width={0.5}
      radius={2}
      fillGradient={gradient.sliderGroove}
      style={{ alignSelf: 'stretch', height: 4 }}
    />
  );
}

export function SeekSlider({ config }: { config?: SliderConfig }) {
  const t = useTheme();
  const hl = config?.highlighted;
  // szerokość toru → pełne wychylenie knoba do końca groove (krawędź knoba do krawędzi toru)
  const [trackW, setTrackW] = useState(0);
  const maxTravel = Math.max(0, (trackW - dims.knob.width) / 2);
  return (
    <View
      style={{
        height: dims.sliderHeight,
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: dims.sliderGap,
        paddingHorizontal: dims.sliderPadding,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        // separator wklęsły dwustronny: góra=cień, dół=światło → widoczny na KAŻDYM motywie
        // (na ciemnej obudowie widać dolne światło, na jasnej górny cień)
        borderTopColor: t.recessedBevel.colors[0],
        borderBottomColor: t.recessedBevel.colors[1],
        userSelect: 'none',
      } as any}
    >
      <SeekButton dir="back" highlighted={hl} onPress={config?.onPrev} />
      <SpeedLabel dir="left" />
      {/* groove ciągły pod knobem; knob wyśrodkowany na wierzchu, wychyla się do końca groove */}
      <View
        style={{ flex: 1, height: dims.knob.height, justifyContent: 'center' }}
        onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }}
        >
          <Track />
        </View>
        <View style={{ alignItems: 'center' }}>
          <Knob highlighted={hl} onAdjust={config?.onAdjust} onScrub={config?.onScrub} onScrubEnd={config?.onScrubEnd} maxTravel={maxTravel} discrete={config?.discrete} />
        </View>
      </View>
      <SpeedLabel dir="right" />
      <SeekButton dir="fwd" highlighted={hl} onPress={config?.onNext} />
    </View>
  );
}
