/**
 * Keyboard — klawiatura dyktafonu (236×158, 2 rzędy × 3).
 * Górny rząd "screen" (zmienia treść ekranu), dolny "metal" (transport).
 * KONTEKSTOWA: zestaw przycisków zależy od ekranu — przekazywany jako `config`
 * (każdy ekran definiuje swój układ). Bez configu → pusta klawiatura (fallback).
 */
import { ReactNode } from 'react';
import { View } from 'react-native';
import { dims, gradient } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { Bevel } from './primitives';
import { MetalLabelKey, RecordKey, ScreenKey, KeyVariant } from './KeyButton';

/** Definicja klawisza "screen" (górny rząd). `variant`: default/primary/risk/highRisk. Pusty label = klawisz bez treści. */
export type ScreenKeyDef = {
  label: string;
  supporting?: string;
  variant?: KeyVariant;
  onPress?: () => void;
  onLongPress?: () => void;
  onHoldComplete?: () => void;
  onHoldStart?: () => void;
  holdMs?: number;
  progress?: number; // statyczny pierścień 0..1 (np. bieg prędkości na SPEED)
};
/** Definicja klawisza "metal" (dolny rząd): etykietowany albo przycisk record. */
export type MetalKeyDef =
  | { type: 'label'; upper: string; lower?: string; active?: boolean; lowerActive?: boolean; onPress?: () => void }
  | { type: 'record'; onPress?: () => void };
/** Pełny układ klawiatury dla danego ekranu (3 "screen" + 3 "metal"). */
export type KeyboardConfig = { screen: ScreenKeyDef[]; metal: MetalKeyDef[] };

/** Pusty układ — bezpieczny fallback gdy ekran nie poda configu (w praktyce zawsze podaje). */
const EMPTY_KEYBOARD: KeyboardConfig = { screen: [], metal: [] };

function Row({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: dims.keyboard.gap }}>
      {children}
    </View>
  );
}

function MetalKey({ def }: { def: MetalKeyDef }) {
  if (def.type === 'record') return <RecordKey onPress={def.onPress} />;
  return (
    <MetalLabelKey upper={def.upper} lower={def.lower} active={def.active} lowerActive={def.lowerActive} onPress={def.onPress} />
  );
}

export function Keyboard({ config = EMPTY_KEYBOARD }: { config?: KeyboardConfig }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: dims.keyboardAreaHeight,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Bevel
        stroke={t.recessedBevel}
        width={1}
        radius={dims.keyboard.radius}
        fillGradient={gradient.keyboard}
        // +1px na obramowania 0.5px (box-border), żeby 3×76 + przerwy zmieściły się bez zawijania
        style={{ width: dims.keyboard.width + 1, height: dims.keyboard.height + 1 }}
        innerStyle={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: dims.keyboard.gap,
          padding: dims.keyboard.padding,
        }}
      >
        <Row>
          {config.screen.map((k, i) => (
            // key = pozycja+label: zmiana klawisza w danym slocie REMONTUJE go → cleanup czyści hold-timer
            // (inaczej z key={i} instancja przeżywa zmianę ekranu i [HOLD] mógł wypalić po nawigacji).
            <ScreenKey
              key={`${i}:${k.label}`}
              label={k.label}
              supporting={k.supporting}
              variant={k.variant}
              onPress={k.onPress}
              onLongPress={k.onLongPress}
              onHoldComplete={k.onHoldComplete}
              onHoldStart={k.onHoldStart}
              holdMs={k.holdMs}
              progress={k.progress}
            />
          ))}
        </Row>
        <Row>
          {config.metal.map((k, i) => (
            <MetalKey key={i} def={k} />
          ))}
        </Row>
      </Bevel>
    </View>
  );
}
