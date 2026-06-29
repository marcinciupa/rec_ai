/**
 * KeyButton — pojedynczy klawisz klawiatury (76×76).
 * Dwie powierzchnie: "screen" (ciemna szyba, górny rząd 1-3, zmienia treść ekranu)
 * i "metal" (#BABABA, dolny rząd 4-6, transport ze zmiennym podświetleniem).
 * W środku okrągła "miska": wklęsła (reduction) lub wypukła (elevation).
 */
import { ReactNode, useRef, useEffect } from 'react';
import { Pressable, View, Text, GestureResponderEvent, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { color, dims, font, gradient, shadow, textShadow, elevationShadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { useTiltCtx } from '../../theme/TiltContext';
import { hapticPress, hapticRelease, hapticShort, hapticHold, hapticCancel } from '../../lib/haptics';
import { Bevel } from './primitives';

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
function ProgressRing({ progress, ringColor }: { progress: Animated.Value; ringColor: string }) {
  const size = dims.keyInner.size; // 60
  const sw = 2;
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
      </Svg>
    </View>
  );
}

/**
 * StaticRing — statyczny pierścień (Figma 121:269 „progress") wypełniony w `fraction` (0..1).
 * Używany np. na klawiszu SPEED do pokazania biegu prędkości (0/25/50/75%). Start od dołu (180°).
 */
function StaticRing({ fraction, ringColor }: { fraction: number; ringColor: string }) {
  const size = dims.keyInner.size; // 60
  const sw = 2;
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
}) {
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
  const startHold = () => {
    completed.current = false;
    onHoldStart?.(); // np. UNDO: reset okna auto-zamknięcia, żeby zdążyć dokończyć hold
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: holdMs, useNativeDriver: false }).start();
    hapticHold(holdMs); // narastające impulsy przez czas przytrzymania
    holdTimer.current = setTimeout(() => {
      completed.current = true;
      onHoldComplete?.();
      hapticRelease(); // mocny impuls potwierdzający wykonanie
      progress.setValue(0);
    }, holdMs);
  };
  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start();
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
      {onHoldComplete ? <ProgressRing progress={progress} ringColor={ringColor} /> : null}
      {progressFraction != null ? <StaticRing fraction={progressFraction} ringColor={ringColor} /> : null}
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

/** Klawisz record — wypukła miska z czerwoną diodą (kolor wg motywu, Body Red; bez poświaty). */
export function RecordKey({ onPress }: { onPress?: () => void }) {
  const t = useTheme();
  return (
    <KeyButton surface="metal" dish="elevation" onPress={onPress}>
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: t.recordRed }} />
    </KeyButton>
  );
}
