/**
 * Wspólne chrome ekranu (w szybie): pasek u góry z deAPI + przełącznikiem trybu
 * (screen_label, node 122:316) oraz placeholder dla trybów jeszcze niezbudowanych.
 * Tryby: RECORDING / PLAYBACK / SETTINGS. Pigułka to „zakamuflowany" button —
 * wygląda jak label, a tapnięcie cykluje tryb.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { hapticPress, hapticRelease, hapticShort } from '../lib/haptics';
import { color, font, screen, textShadow } from '../theme/tokens';
import { useBlink } from '../theme/BlinkContext';
import { DeApiIcon } from '../components/icons';
import type { AiStatusView } from '../hooks/useTranscription';

export type Mode = 'RECORDING' | 'PLAYBACK' | 'SETTINGS';

const NEXT: Record<Mode, Mode> = {
  RECORDING: 'PLAYBACK',
  PLAYBACK: 'SETTINGS',
  SETTINGS: 'RECORDING',
};
export const nextMode = (m: Mode): Mode => NEXT[m];

/**
 * Lewy klawisz metalowy = FIZYCZNY klawisz `STOP/BACK` — label STAŁY na wszystkich ekranach,
 * zmienia się tylko PODŚWIETLENIE (jak PLAY/PAUSE). STOP świeci gdy jest co zatrzymać, BACK gdy dostępny
 * powrót, oba zgaszone gdy nic. Klik = akcja podświetlona. Używać NA KAŻDYM ekranie dla metal[0].
 */
export function stopBackKey(opts: { canStop?: boolean; onStop?: () => void; onBack?: () => void }) {
  const canStop = !!opts.canStop;
  const backLit = !canStop && !!opts.onBack;
  return {
    type: 'label' as const,
    upper: 'STOP',
    lower: 'BACK',
    active: canStop,
    lowerActive: backLit,
    onPress: canStop ? opts.onStop : opts.onBack,
  };
}

/** Pigułka trybu. `active` = pełne tło + glow; inaczej wygaszone (25% tła, bez glow).
 *  `blink` = miga (1s on/off) razem z diodą LED (podczas nagrywania).
 *  REC = czerwona z kropką; pozostałe = phosphor. */
function ScreenLabel({
  mode,
  onPress,
  active = true,
  blink = false,
}: {
  mode: Mode;
  onPress?: () => void;
  active?: boolean;
  blink?: boolean;
}) {
  const on = useBlink();
  // blink przełącza Active↔Inactive (jasny+glow ↔ wygaszony 25%), bez znikania
  const isActive = blink ? on : active;
  const isRec = mode === 'RECORDING';
  const bg = isActive
    ? isRec
      ? color.recordRed
      : screen.olive.primary
    : isRec
      ? screen.red.inactive
      : screen.olive.inactive;
  const boxShadow = isActive
    ? isRec
      ? '0px 0px 4px 0px rgba(255,107,107,0.25)'
      : '0px 0px 4px 0px rgba(226,255,228,0.25)'
    : undefined;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPress ? hapticPress : hapticShort}
      onPressOut={onPress ? hapticRelease : hapticShort}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: isRec ? 8 : 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 2,
        backgroundColor: bg,
        ...(boxShadow ? { boxShadow } : null),
      }}
    >
      {isRec ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.dark21 }} /> : null}
      <Text style={{ fontFamily: font.bodyLgBold.family, fontSize: font.bodyLgBold.size, color: color.dark21 }}>
        {isRec ? 'REC' : mode}
      </Text>
    </Pressable>
  );
}

const phosphorGlow = {
  textShadowColor: textShadow.phosphor.color,
  textShadowRadius: 4,
  textShadowOffset: { width: 0, height: 0 },
} as const;

/** Znaczek deAPI: przygaszony (IDLE, lines=null) lub aktywny z 2-liniowym tekstem.
 *  `pulse` (upload/processing) = ikona pulsuje opacity 1↔0.6. Kolor ZAWSZE phosphor (nigdy czerwony). */
function DeApiLabel({ ai }: { ai?: AiStatusView }) {
  const pulse = !!ai?.pulse;
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      op.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.6, duration: 700, useNativeDriver: false }),
        Animated.timing(op, { toValue: 1, duration: 700, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, op]);

  if (!ai || ai.lines === null) {
    return (
      <View style={{ opacity: 0.25 }}>
        <DeApiIcon size={24} />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Animated.View style={{ opacity: pulse ? op : 1 }}>
        <DeApiIcon size={24} />
      </Animated.View>
      <View>
        {ai.lines.map((line, i) => (
          <Text
            key={i}
            style={{
              fontFamily: font.caption.family,
              fontSize: font.caption.size,
              color: screen.olive.primary,
              ...phosphorGlow,
            }}
          >
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Pasek statusu w szybie: deAPI z lewej (przygaszony lub aktywny z tekstem AI), przełącznik trybu z prawej. */
export function ScreenTopBar({
  mode,
  onCycleMode,
  ai,
  labelActive = true,
  labelBlink = false,
}: {
  mode: Mode;
  onCycleMode?: () => void;
  ai?: AiStatusView;
  labelActive?: boolean;
  labelBlink?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        alignSelf: 'stretch',
      }}
    >
      <DeApiLabel ai={ai} />
      <ScreenLabel mode={mode} onPress={onCycleMode} active={labelActive} blink={labelBlink} />
    </View>
  );
}

/** Segment miernika poziomu. Zapalony = samo wypełnienie (bez obrysu, by się nie nakładał);
 *  zgaszony = sam obrys phosphor 25%. */
function MeterBar({ lit, color: litColor }: { lit?: boolean; color?: string }) {
  return (
    <View
      style={{
        width: 8,
        height: 12,
        borderRadius: 2,
        borderWidth: lit ? 0 : 1,
        borderColor: screen.olive.inactive,
        backgroundColor: lit ? litColor : 'transparent',
      }}
    />
  );
}

/** Znaczek kanału L/R — phosphorowy kwadracik z ciemną literą. */
function ChannelBadge({ ch }: { ch: 'L' | 'R' }) {
  return (
    <View
      style={{
        width: 12,
        height: 12,
        borderRadius: 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: screen.olive.primary,
        boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)',
      }}
    >
      <Text style={{ fontFamily: font.captionBold.family, fontSize: font.captionBold.size, color: color.dark1A }}>
        {ch}
      </Text>
    </View>
  );
}

const METER_SEGMENTS = 6;

/**
 * Dolny pasek szyby: miernik stereo (L … STEREO/UHQ … R). Wspólny dla ekranów.
 * `active` → segmenty animują poziom (mock); `mono` → oba kanały zsynchronizowane;
 * `muted` → segmenty w kolorze inactive olive, ale nadal animują. Bez `active` = statyczny.
 */
export function BottomBar({
  active = false,
  mono = false,
  muted = false,
  level = null,
}: {
  active?: boolean;
  mono?: boolean;
  muted?: boolean;
  level?: number | null; // realny poziom 0..1 (metering); null = mock (losowo)
}) {
  const [lvl, setLvl] = useState({ l: 0, r: 0 });
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    if (!active) {
      setLvl({ l: 0, r: 0 });
      return;
    }
    const rnd = () => Math.floor(Math.random() * (METER_SEGMENTS + 1));
    const id = setInterval(() => {
      const lv = levelRef.current;
      if (lv != null) {
        // realny poziom → segmenty; R lekko zróżnicowane dla „życia" w stereo (z tej samej obwiedni)
        const segs = Math.round(lv * METER_SEGMENTS);
        const r = mono ? segs : Math.max(0, Math.min(METER_SEGMENTS, segs - (Math.random() < 0.5 ? 0 : 1)));
        setLvl({ l: segs, r });
      } else {
        const l = rnd();
        setLvl({ l, r: mono ? l : rnd() });
      }
    }, 120);
    return () => clearInterval(id);
  }, [active, mono]);

  const litColor = muted ? screen.olive.inactive : screen.olive.primary;
  // lewy kanał: zapalone NAJBLIŻEJ pastylki (prawa strona) = ostatnie `l` segmentów
  const left = Array.from({ length: METER_SEGMENTS }, (_, i) => i >= METER_SEGMENTS - lvl.l);
  // prawy kanał: zapalone najbliżej pastylki (lewa strona) = pierwsze `r` segmentów
  const right = Array.from({ length: METER_SEGMENTS }, (_, i) => i < lvl.r);

  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', alignSelf: 'stretch' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {left.map((on, i) => (
          <MeterBar key={i} lit={on} color={litColor} />
        ))}
        <ChannelBadge ch="L" />
      </View>
      <Text
        style={{
          fontFamily: font.caption.family,
          fontSize: font.caption.size,
          color: screen.olive.primary,
          ...phosphorGlow,
        }}
      >
        {mono ? 'MONO/UHQ' : 'STEREO/UHQ'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <ChannelBadge ch="R" />
        {right.map((on, i) => (
          <MeterBar key={i} lit={on} color={litColor} />
        ))}
      </View>
    </View>
  );
}
