/**
 * Joystick — środek klawiatury dyktafonu (Figma 375:4962). JEDYNA kontrolka kursora w apce.
 * Fizycznie: metalowy kwadrat 76 (wypukły bevel, jak zwykły klawisz) → wklęsła ciemna studnia 66 →
 * wypukły grzybek 24 (przesuwa się za palcem, sprężynuje na środek). Mechanika + haptyka z bliźniaczego
 * projektu gallery_ai (opór progresywny, zmiana kierunku w locie, auto-repeat). Patrz DESIGN_JOYSTICK.md.
 *
 * GRAMATYKA (identyczna na każdym ekranie): ↑↓ = pozycja (element listy), ←→ = wartość / ruch wewnątrz
 * elementu, środek = ZATWIERDŹ (akcja zaznaczonego elementu). Nagrywanie NIE jest domyślną rolą środka —
 * czerwony grzybek (`tone: 'rec'`) pojawia się TYLKO tam, gdzie wciśnięcie faktycznie nagrywa
 * (ekran RECORDING, pytanie głosowe w czacie). Wszędzie indziej grzybek jest metalowy, jak w gallery_ai.
 */
import { useEffect, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { dims, gradient, shadow, elevationShadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { Bevel } from './primitives';
import { hapticKnob, hapticKnobReturn, hapticPress, hapticRelease, hapticShort } from '../../lib/haptics';

/** Konfiguracja joysticka dla danego ekranu (kontekstowa jak KeyboardConfig/SliderConfig). */
export type JoystickConfig = {
  /** nawigacja aktywna → jaśniejszy metal grzybka (afordancja „da się ruszyć") */
  highlighted?: boolean;
  /** 'rec' = grzybek czerwony z poświatą. TYLKO gdy wciśnięcie środka nagrywa. Domyślnie metal. */
  tone?: 'metal' | 'rec';
  /** trwa nagrywanie → mocniejsza poświata czerwieni (dioda REC) */
  recActive?: boolean;
  /** przytrzymanie wychylenia powtarza kierunek: true = wszystkie osie, 'vertical' = tylko ↑↓ */
  repeat?: boolean | 'vertical';
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  /** wciśnięcie środka = ZATWIERDŹ (albo REC na ekranach z `tone: 'rec'`) */
  onPress?: () => void;
};

type Dir = 'up' | 'down' | 'left' | 'right';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function Joystick({ config }: { config?: JoystickConfig }) {
  const t = useTheme();
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  const curDir = useRef<Dir | null>(null); // kierunek trzymany TERAZ (do zmiany w locie)
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const callDir = (dir: Dir) => {
    const c = cfgRef.current;
    (dir === 'right' ? c?.onRight : dir === 'left' ? c?.onLeft : dir === 'down' ? c?.onDown : c?.onUp)?.();
  };
  const stopRepeat = () => {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };
  /** czy dany kierunek ma auto-repeat (pion na długich listach; poziom tylko gdy `repeat: true`) */
  const repeats = (dir: Dir) => {
    const r = cfgRef.current?.repeat;
    if (!r) return false;
    return r === 'vertical' ? dir === 'up' || dir === 'down' : true;
  };
  // przytrzymanie wychylenia → powtarzaj kierunek co 120 ms aż do puszczenia (przewijanie długiej listy).
  // Haptyka co drugi tick (~240 ms): przy 120 ms czyta się jak ciągłe brzęczenie.
  const startRepeat = (dir: Dir) => {
    if (!repeats(dir)) return;
    stopRepeat();
    let tick = 0;
    repeatTimer.current = setInterval(() => {
      callDir(dir);
      if (tick++ % 2 === 0) hapticKnob(0.3, 14);
    }, 120);
  };
  useEffect(() => () => stopRepeat(), []);

  // OPÓR PROGRESYWNY (przeniesione z gallery_ai): im dalej wychylisz gałkę, tym mocniejszy impuls —
  // imitacja rosnącego oporu sprężyny. Droga gałki dzielona na DETENTS zapadek; impuls leci przy KAŻDYM
  // przekroczeniu zapadki W STRONĘ WYCHYLENIA (przy powrocie do środka nie — opór maleje, nie rośnie).
  // Bez kwantyzacji na zapadki trzeba by strzelać haptyką na każde zdarzenie ruchu (~60/s) = brzęczenie.
  const DETENTS = 6;
  const lastDetent = useRef(0);
  const detentAt = (dist: number, max: number) => Math.min(DETENTS, Math.round((Math.min(dist, max) / max) * DETENTS));

  const springBack = () => {
    Animated.spring(tx, { toValue: 0, useNativeDriver: false }).start();
    Animated.spring(ty, { toValue: 0, useNativeDriver: false }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 3,
      // nie oddawaj gestu innym responderom (np. ekranowemu swipe) — inaczej poziome ruchy joysticka giną
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        fired.current = false;
        curDir.current = null;
        lastDetent.current = 0;
        const c = cfgRef.current;
        const hasAny = !!(c && (c.onUp || c.onDown || c.onLeft || c.onRight || c.onPress));
        hasAny ? hapticPress() : hapticShort();
      },
      onPanResponderMove: (_e, g) => {
        const max = dims.joystick.nubTravel;
        tx.setValue(clamp(g.dx, -max, max));
        ty.setValue(clamp(g.dy, -max, max));
        // opór progresywny: impuls na przekroczeniu zapadki w stronę wychylenia; na powrocie do neutrum
        // (jeszcze w trakcie gestu) delikatny „klik" zerowy. Puszczenie gałki ma osobny hapticKnobReturn.
        const det = detentAt(Math.hypot(g.dx, g.dy), max);
        if (det > lastDetent.current) hapticKnob(0.12 + 0.62 * (det / DETENTS), 12);
        else if (det === 0 && lastDetent.current > 0) hapticKnob(0.1, 10);
        lastDetent.current = det;
        const th = dims.joystick.dirThreshold;
        const ax = Math.abs(g.dx), ay = Math.abs(g.dy);
        // odpal, gdy dominująca oś przekroczy próg i WYRAŹNIE przeważa (≥1.3×) — inaczej skośny gest
        // odpala w bok zamiast w dół/górę.
        const dom = Math.max(ax, ay), sub = Math.min(ax, ay);
        if (!(dom > th && dom >= sub * 1.3)) return;
        const dir: Dir = ax >= ay ? (g.dx > 0 ? 'right' : 'left') : (g.dy > 0 ? 'down' : 'up');
        if (dir === curDir.current) return; // ten sam kierunek → nic nowego
        // ZMIANA KIERUNKU W LOCIE (z gallery_ai): przestawienie gałki przełącza nawigację bez odrywania
        // palca. Haptyka „dzieje się sama" — gałka schodzi przez zapadki do zera i narasta po drugiej stronie.
        fired.current = true;
        curDir.current = dir;
        stopRepeat(); // przy zmianie kierunku stary auto-repeat musi zgasnąć, inaczej lecą oba naraz
        callDir(dir);
        startRepeat(dir);
        lastDetent.current = DETENTS; // nie dubluj zapadki z impulsem złapania kierunku
        hapticKnob(0.5); // krótki impuls na zmianie (jak knob discrete)
      },
      onPanResponderRelease: (_e, g) => {
        stopRepeat();
        springBack();
        const moved = Math.hypot(g.dx, g.dy);
        const c = cfgRef.current;
        if (!fired.current && moved < 6) {
          // brak wychylenia → wciśnięcie środka (ZATWIERDŹ / REC)
          c?.onPress?.();
          hapticRelease();
        } else {
          hapticKnobReturn(!!c?.highlighted);
        }
        fired.current = false;
        curDir.current = null;
        lastDetent.current = 0;
      },
      onPanResponderTerminate: () => {
        stopRepeat();
        springBack();
        fired.current = false;
        curDir.current = null;
        lastDetent.current = 0;
      },
    })
  ).current;

  const rec = t.recessedBevel;
  const isRec = config?.tone === 'rec';
  const hl = config?.highlighted;
  return (
    // outer: metalowy kwadrat 76 (wypukły bevel — jak zwykły klawisz)
    <Bevel
      stroke={t.raisedBevel}
      width={1}
      radius={dims.key.radius}
      fill={t.metal}
      style={{ width: dims.joystick.size, height: dims.joystick.size }}
      innerStyle={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <View {...pan.panHandlers} style={{ padding: dims.joystick.wellOffset }}>
        {/* studnia: wklęsła ciemna kołowa wnęka (recessed bevel + inset shadow). Plain View (bez overflow
            hidden Bevela), żeby wypukły cień grzybka się nie obciął. */}
        <View
          style={
            {
              width: dims.joystick.well,
              height: dims.joystick.well,
              borderRadius: dims.joystick.wellRadius,
              backgroundColor: '#1A1A1A',
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderBottomWidth: 1,
              borderRightWidth: 1,
              borderTopColor: rec.colors[0], // recessed: cień góra+lewo
              borderLeftColor: rec.colors[0],
              borderBottomColor: rec.colors[1], // światło dół+prawo
              borderRightColor: rec.colors[1],
              boxShadow: shadow.keyInsetReduction,
              alignItems: 'center',
              justifyContent: 'center',
            } as any
          }
        >
          {/* grzybek: wypukły dysk 24 przesuwający się za palcem.
              • tone 'rec'  → cały czerwony z poświatą (Figma 375:4962) = dioda REC. Poświata mocniejsza,
                gdy faktycznie nagrywamy (`recActive`).
              • tone 'metal' (domyślnie) → metalowy jak w gallery_ai; `highlighted` = jaśniejszy stop
                (nawigacja aktywna). */}
          <Animated.View style={{ transform: [{ translateX: tx }, { translateY: ty }] }}>
            <Bevel
              stroke={isRec ? gradient.recordNubStroke : t.raisedBevel}
              width={1}
              radius={dims.joystick.nub / 2}
              fillGradient={isRec ? gradient.bevelRed : hl ? gradient.bevelButton : gradient.bevelSharp}
              style={
                {
                  width: dims.joystick.nub,
                  height: dims.joystick.nub,
                  boxShadow: isRec
                    ? `${elevationShadow(t)}, ${config?.recActive ? shadow.recordGlowStrong : shadow.recordGlow}`
                    : elevationShadow(t),
                } as any
              }
            />
          </Animated.View>
        </View>
      </View>
    </Bevel>
  );
}
