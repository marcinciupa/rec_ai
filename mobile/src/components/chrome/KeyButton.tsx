/**
 * KeyButton — pojedynczy klawisz klawiatury (76×76).
 * Dwie powierzchnie: "screen" (ciemna szyba, górny rząd 1-3, zmienia treść ekranu)
 * i "metal" (#BABABA, dolny rząd 4-6, transport ze zmiennym podświetleniem).
 * W środku okrągła "miska": wklęsła (reduction) lub wypukła (elevation).
 */
import { ReactNode, useRef, useEffect, useState } from 'react';
import { Pressable, View, Text, GestureResponderEvent, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { color, dims, font, gradient, shadow, textShadow, elevationShadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { useTiltCtx } from '../../theme/TiltContext';
import { hapticPress, hapticRelease, hapticShort, hapticHold, hapticCancel } from '../../lib/haptics';
import { Bevel } from './primitives';
import { KeyIcon } from '../icons/KeyIcon';
import type { KeyIconName } from '../icons/keyIcons.gen';

// Label klawisza → nazwa ikony (zestaw wspólny z gallery_ai). Mapujemy TYLKO labelki z pasującą ikoną
// generyczną; klawisze specyficzne dla dyktafonu (REC/STOP/TRANSCRIBE/ASK AI…) zostają tekstem do czasu
// dołożenia dedykowanego zestawu ikon rec_ai z Figmy. Patrz DESIGN_JOYSTICK.md/ikonowy backlog.
const LABEL_ICON: Record<string, KeyIconName> = {
  BACK: 'back', CLOSE: 'close', CANCEL: 'close', ABORT: 'close', MENU: 'menu', CONFIRM: 'confirm',
  ACCEPT: 'confirm', YES: 'confirm', NEXT: 'skip', PLAY: 'start', INFO: 'info', SHARE: 'send',
  UNDO: 'undo', DELETE: 'delete', 'KEY-\nBOARD': 'keyboard', SAVE: 'save', RESET: 'reset',
  // ikony specyficzne dla dyktafonu (Figma 496:24601, dodane 2026-07-24)
  SETTINGS: 'settings', STOP: 'stop', PAUSE: 'pause', MUTE: 'mute', UNMUTE: 'unmute',
  // SHOW DETAILS dostaje „i" w kółku, a nie lupę nad listą (`details`): na liście nagrań ta akcja
  // otwiera metryczkę pliku, czyli klasyczne INFO — i tak ją czyta oko.
  DETAILS: 'details', 'SHOW DETAILS': 'info', 'SHOW INFO': 'info',
  TASKS: 'to_do_list', SUMMARY: 'summary', 'SUM-\nMARY': 'summary',
  'KEY POINTS': 'ai_key_points', 'KEY\nPOINTS': 'ai_key_points',
  // TRANSCRIBE dostaje chip „AI", a nie mikrofon z linijkami (`transcribe`): klawisz zleca pracę
  // modelowi, a nie nagrywa — a mikrofon myli się z nagrywaniem, które w tej apce jest osobną akcją.
  TRANSCRIBE: 'ai', 'TRANS-\nCRIBE': 'ai',
  'RE-TRANSCRIBE': 'ai', 'RE-TRANS-\nCRIBE': 'ai',
  // lista nagrań = recordings_2 (wybór autora), samo urządzenie/nagrywanie = recorder
  RECORDINGS: 'recordings_2', 'RECORD-\nINGS': 'recordings_2', REC: 'recorder',
  // Przełącznik w ustawieniach. Klawisz #1 pokazuje WARTOŚĆ, NA KTÓRĄ przełączy (ta sama zasada, co
  // przy THEME czy PLAYBACK TIMER), więc: „TURN ON" → gałka w prawo, „TURN OFF" → gałka w lewo.
  'TURN ON': 'toggle_right', 'TURN OFF': 'toggle_left',
  'ASK AI': 'ai_chat', 'ASK\nAI': 'ai_chat',
  // wartość „na którą przełączy" w wierszu VIEW ma swoją ikonę; DEVICE zostaje tekstem, bo nie ma
  FULLSCREEN: 'fullscreen', 'FULL-\nSCREEN': 'fullscreen',
  // wartości wierszy, które mają WŁASNE ikony (a nie jedną wspólną dla całego wiersza) — glif mówi
  // dokładnie to samo co słowo, więc w trybie KEY ICONS nic nie ginie
  ELAPSED: 'elapsed', REMAINING: 'remaining', 'REMAIN-\nING': 'remaining',
  RIGHT: 'handed_right', LEFT: 'handed_left',
  // domyślna etykieta klawisza #1 w ustawieniach (gdy wiersz nie ma nic lepszego do pokazania)
  CHANGE: 'change',
  // SPEED: ikona zależna od biegu — patrz jawny `icon` na klawiszu w PlaybackScreen (speed_1x…10x).
};
import { ScreenMatrix } from './ScreenMatrix';

/**
 * Stan "clicked" (Figma 121:269): nakładka `dim` na cały przycisk (rgba(26,26,26,0.25))
 * + wciśnięcie do środka (effect_WEM3YK). Jednolite dla wszystkich typów klawiszy.
 */
const CLICKED_INSET = 'inset 4px 4px 4px rgba(26,26,26,0.25)';
export function ClickedDim({ radius }: { radius?: number } = {}) {
  return (
    <View
      pointerEvents="none"
      style={
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: radius,
          backgroundColor: 'rgba(26,26,26,0.25)',
          boxShadow: CLICKED_INSET,
        } as any
      }
    />
  );
}

/**
 * ProgressRing — pierścień postępu przytrzymania (Figma 121:269 „progress"),
 * 60×60 nad miską klawisza, wypełnia się 0→1 w trakcie hold. Driven by Animated.Value.
 */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
function ProgressRing({ progress, ringColor, dot }: { progress: Animated.Value; ringColor: string; dot?: boolean }) {
  const size = dims.keyInner.size; // 60
  const sw = 4; // 2× grubość; kropka = sw, r = (size-sw)/2 trzyma krawędź na size/2 (średnica inner_reduction)
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = progress.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
      <Svg width={size} height={size}>
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ringColor}
          strokeWidth={sw}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset as any}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* kropka w punkcie STARTU pierścienia (góra, 12:00), średnica = szerokość ringa */}
        {dot ? <Circle cx={size / 2} cy={sw / 2} r={sw / 2} fill={ringColor} /> : null}
      </Svg>
    </View>
  );
}

/**
 * StaticRing — statyczny pierścień (Figma 121:269 „progress") wypełniony w `fraction` (0..1).
 * Używany np. na klawiszu SPEED do pokazania biegu prędkości (0/25/50/75%). Start od dołu (180°).
 */
function StaticRing({ fraction, ringColor, dot }: { fraction: number; ringColor: string; dot?: boolean }) {
  const size = dims.keyInner.size; // 60
  const sw = 4; // 2× grubość; kropka = sw, r = (size-sw)/2 trzyma krawędź na size/2 (średnica inner_reduction)
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ringColor}
          strokeWidth={sw}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          strokeLinecap="round"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
        />
        {/* kropka w punkcie STARTU pierścienia (dół, 6:00), średnica = szerokość ringa */}
        {dot ? <Circle cx={size / 2} cy={size - sw / 2} r={sw / 2} fill={ringColor} /> : null}
      </Svg>
    </View>
  );
}

/** Połysk szyby przycisku "screen" — biały gradient TL→BR, sunie z przechyleniem. */
function ScreenSheen() {
  const tilt = useTiltCtx();
  const x = tilt ? tilt.tx.interpolate({ inputRange: [-1, 1], outputRange: [-24, 24] }) : 0;
  // jasność rośnie z wychyleniem: spoczynek ~0.6 (×0.4 peak ≈ jak dotąd), pełny tilt 1.0 → mocniejszy błysk
  const opacity = tilt ? tilt.tx.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0.6, 1] }) : 0.6;
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, bottom: 0, left: -28, right: -28, opacity, transform: [{ translateX: x }] } as any}
    >
      <LinearGradient
        colors={gradient.keyScreen.colors}
        start={gradient.keyScreen.start}
        end={gradient.keyScreen.end}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

type Dish = 'reduction' | 'elevation' | 'none';

/** Wariant klawisza "screen" (Message Type z Figmy): default=phosphor tekst, primary=phosphor tło,
 *  risk=czerwony tekst (DELETE/MUTE), highRisk=czerwone tło (UNMUTE). */
export type KeyVariant = 'default' | 'primary' | 'risk' | 'highRisk';
const PHOSPHOR_GLOW = '0px 0px 4px 0px rgba(226,255,228,0.25)';
const RED_GLOW = '0px 0px 4px 0px rgba(255,76,76,0.25)';

function KeyButton({
  surface,
  dish = 'reduction',
  variant = 'default',
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  children,
}: {
  surface: 'screen' | 'metal';
  dish?: Dish;
  variant?: KeyVariant;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children?: ReactNode;
}) {
  const t = useTheme();
  // wibracja KAŻDEGO klawisza: hold → własna (startHold/cancelHold); aktywny → press/release;
  // pusty/nieaktywny (bez onPress) → krótka na wejściu i wyjściu.
  const handlePressIn = () => {
    if (onPressIn) {
      onPressIn();
      return;
    }
    onPress ? hapticPress() : hapticShort();
  };
  const handlePressOut = () => {
    if (onPressOut) {
      onPressOut();
      return;
    }
    onPress ? hapticRelease() : hapticShort();
  };
  const tile = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {/* centralna miska 60×60 */}
      {dish !== 'none' && (
        <View
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            width: dims.keyInner.size,
            height: dims.keyInner.size,
            borderRadius: dims.keyInner.radius,
            backgroundColor:
              dish === 'reduction' ? 'rgba(26,26,26,0.05)' : t.metal,
            boxShadow: dish === 'reduction' ? shadow.keyInsetReduction : elevationShadow(t),
          }}
        />
      )}
      {children}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{
        width: dims.key.size,
        height: dims.key.size,
        // podświetlone warianty (primary=phosphor, highRisk=czerwień) mają poświatę
        ...(variant === 'primary'
          ? { boxShadow: PHOSPHOR_GLOW }
          : variant === 'highRisk'
            ? { boxShadow: RED_GLOW }
            : null),
      }}
    >
      {({ pressed }) =>
        surface === 'screen' ? (
          // nakładka clicked NAD Bevelem — inner-shadow zasłania też obrys/bevel
          <View style={{ flex: 1 }}>
            <Bevel
              stroke={gradient.keyScreenStroke}
              width={1}
              radius={dims.key.radius}
              fill={variant === 'primary' ? color.phosphor : variant === 'highRisk' ? color.recordRed : color.dark1A}
              style={{ flex: 1 }}
              innerStyle={{ padding: dims.key.padding }}
            >
              {tile}
              {/* matryca ekranu: między treścią a połyskiem/glow (Figma „matrix") */}
              <ScreenMatrix radius={dims.key.radius} />
              {/* połysk klawisza ZAWSZE NAD treścią (pointerEvents none) */}
              <ScreenSheen />
            </Bevel>
            {pressed ? <ClickedDim radius={dims.key.radius} /> : null}
          </View>
        ) : (
          // klawisze fizyczne (metal): nakładka clicked NAD Bevelem, żeby przyciemniała też obrys
          <View style={{ flex: 1 }}>
            <Bevel
              stroke={t.raisedBevel}
              width={1}
              radius={dims.key.radius}
              fill={t.metal}
              style={{ flex: 1 }}
              innerStyle={{ padding: dims.key.padding }}
            >
              {tile}
            </Bevel>
            {pressed ? <ClickedDim radius={dims.key.radius} /> : null}
          </View>
        )
      }
    </Pressable>
  );
}

/**
 * Klawisz "screen" z etykietą + opcjonalnym labelem pomocniczym (np. [CLOSE]).
 * variant: default=phosphor tekst, primary=ciemny na phosphor, risk=czerwony tekst,
 * highRisk=ciemny na czerwieni.
 */
export function ScreenKey({
  label,
  supporting,
  variant = 'default',
  onPress,
  onLongPress,
  onHoldComplete,
  onHoldStart,
  holdMs = 2000,
  progress: progressFraction,
  icons,
  icon,
}: {
  label: string;
  supporting?: string;
  variant?: KeyVariant;
  onPress?: () => void;
  onLongPress?: () => void;
  onHoldComplete?: () => void;
  onHoldStart?: () => void;
  holdMs?: number;
  progress?: number; // statyczny pierścień 0..1 (np. bieg prędkości na SPEED); niezależny od holdu
  icons?: boolean; // tryb KEY ICONS — renderuj ikonę zamiast tekstu (gdy label mapuje się na ikonę)
  icon?: KeyIconName; // jawna ikona — nadpisuje mapę LABEL_ICON
}) {
  const iconName = icon ?? LABEL_ICON[label];
  // kolor tekstu: primary/highRisk = ciemny (na jasnym tle, bez glow); risk = czerwony+glow; default = phosphor+glow
  const dark = variant === 'primary' || variant === 'highRisk';
  const fg = dark ? color.dark1A : variant === 'risk' ? color.recordRed : color.phosphor;
  const glowColor = variant === 'risk' ? 'rgba(255,76,76,0.25)' : textShadow.phosphor.color;
  const glow = dark
    ? null
    : { textShadowColor: glowColor, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } as const };

  // przytrzymanie z pierścieniem postępu (np. ABORT [HOLD] — 2 s). Puść wcześniej = reset.
  const progress = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<any>(null);
  const completed = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      hapticCancel();
    },
    []
  );
  // czy trwa przytrzymanie — na czas holdu chowamy statyczny pierścień (np. bieg SPEED), żeby
  // pierścień postępu był jedyną rzeczą, jaką widać; po zakończeniu wraca sam
  const [holding, setHolding] = useState(false);
  // Numer przytrzymania. Wygaszenie pierścienia to animacja z callbackiem, a RN woła callback także
  // wtedy, gdy animację PRZERWANO (`finished: false`) — czyli nowy hold rozpoczęty w trakcie zanikania
  // poprzedniego dostawał od niego `setHolding(false)` i przez całe przytrzymanie widać było statyczny
  // pierścień (np. bieg SPEED), który hold ma zakrywać. Callback działa więc tylko dla swojego holdu.
  const holdSeq = useRef(0);
  const startHold = () => {
    completed.current = false;
    const seq = ++holdSeq.current;
    setHolding(true);
    onHoldStart?.(); // np. UNDO: reset okna auto-zamknięcia, żeby zdążyć dokończyć hold
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: holdMs, useNativeDriver: false }).start();
    hapticHold(holdMs); // narastające impulsy przez czas przytrzymania
    holdTimer.current = setTimeout(() => {
      completed.current = true;
      onHoldComplete?.();
      hapticRelease(); // mocny impuls potwierdzający wykonanie
      // pierścień COFA SIĘ do stanu początkowego, zamiast znikać skokiem — akcja się wykonała,
      // więc kontrolka ma wrócić do spoczynku w sposób widoczny, a nie zgasnąć w jednej klatce
      Animated.timing(progress, { toValue: 0, duration: 250, useNativeDriver: false }).start(() => {
        if (holdSeq.current === seq) setHolding(false);
      });
    }, holdMs);
  };
  const cancelHold = () => {
    const seq = holdSeq.current;
    clearTimeout(holdTimer.current);
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
      if (holdSeq.current === seq) setHolding(false);
    });
    if (!completed.current) hapticCancel(); // puszczono przed końcem → przerwij wibrację
  };
  // pierścień hold: na ciemnym tekście (primary/highRisk = jasne/czerwone tło) ciemny; risk = czerwony; reszta phosphor
  const ringColor = dark ? color.dark1A : variant === 'risk' ? color.recordRed : color.phosphor;
  // klawisz może mieć JEDNOCZEŚNIE onPress (tap) i onHoldComplete (hold) — np. DELETE.
  // Po ukończonym holdzie pomijamy onPress (Pressable odpaliłby je na puszczeniu).
  const handlePress = () => {
    if (completed.current) {
      completed.current = false;
      return;
    }
    onPress?.();
  };

  return (
    <KeyButton
      surface="screen"
      dish="reduction"
      variant={variant}
      onPress={onPress ? handlePress : undefined}
      onLongPress={onLongPress}
      onPressIn={onHoldComplete ? startHold : undefined}
      onPressOut={onHoldComplete ? cancelHold : undefined}
    >
      {onHoldComplete ? <ProgressRing progress={progress} ringColor={ringColor} dot={!!(icons && iconName)} /> : null}
      {progressFraction != null && !holding ? <StaticRing fraction={progressFraction} ringColor={ringColor} dot={!!(icons && iconName)} /> : null}
      {icons && iconName ? (
        // TRYB IKON: sam glif wyśrodkowany; support (np. [HOLD]) NIE jest tekstem — zastępuje go kropka
        // na starcie pierścienia (patrz ProgressRing/StaticRing `dot`).
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          <KeyIcon name={iconName} size={26} color={fg} glow={!!glow} />
        </View>
      ) : (
        <>
          <Text
            style={{
              fontFamily: font.monoLabel.family,
              fontSize: font.monoLabel.size,
              color: fg,
              textAlign: 'center',
              ...glow,
            }}
          >
            {label}
          </Text>
          {supporting ? (
            <Text
              style={{
                fontFamily: font.monoCaption.family,
                fontSize: font.monoCaption.size,
                color: fg,
                textAlign: 'center',
                ...glow,
              }}
            >
              {supporting}
            </Text>
          ) : null}
        </>
      )}
    </KeyButton>
  );
}

/**
 * Klawisz metalowy z pojedynczą/podwójną etykietą (STOP, PLAY/PAUSE).
 * `active` = napis aktywny (buttonActive) vs wygaszony (buttonInactive) — wg motywu.
 */
export function MetalLabelKey({
  upper,
  lower,
  active = true,
  lowerActive = false,
  onPress,
}: {
  upper: string;
  lower?: string;
  active?: boolean; // podświetlenie GÓRNEGO napisu
  lowerActive?: boolean; // podświetlenie DOLNEGO napisu (np. PAUSE gdy odtwarzamy)
  onPress?: () => void;
}) {
  const t = useTheme();
  const base = {
    fontFamily: font.uiLabel.family,
    fontSize: font.uiLabel.size,
    textAlign: 'center' as const,
  };
  // poświata tylko dla aktywnego napisu (podświetlenie); wygaszony bez glow
  const lineGlow = {
    textShadowColor: textShadow.whiteGlow.color,
    textShadowRadius: textShadow.whiteGlow.radius,
    textShadowOffset: { width: 0, height: 0 } as const,
  };
  return (
    <KeyButton surface="metal" dish="none" onPress={onPress}>
      <View style={{ alignItems: 'center' }}>
        <Text style={[base, active ? lineGlow : null, { color: active ? t.buttonActive : t.buttonInactive }]}>{upper}</Text>
        {lower ? (
          <Text style={[base, lowerActive ? lineGlow : null, { color: lowerActive ? t.buttonActive : t.buttonInactive }]}>{lower}</Text>
        ) : null}
      </View>
    </KeyButton>
  );
}
