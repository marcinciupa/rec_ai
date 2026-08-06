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
import { MetalLabelKey, ScreenKey, KeyVariant } from './KeyButton';
import { Joystick, JoystickConfig } from './Joystick';
import type { KeyIconName } from '../icons/keyIcons.gen';

/** Definicja klawisza "screen" (górny rząd). `variant`: default/primary/risk/highRisk. Pusty label = klawisz bez treści. */
export type ScreenKeyDef = {
  label: string;
  supporting?: string;
  variant?: KeyVariant;
  /** Jawna ikona (tryb KEY ICONS) — nadpisuje mapę label→ikona. */
  icon?: KeyIconName;
  onPress?: () => void;
  onLongPress?: () => void;
  onHoldComplete?: () => void;
  onHoldStart?: () => void;
  holdMs?: number;
  progress?: number; // statyczny pierścień 0..1 (np. bieg prędkości na SPEED)
};
/**
 * Definicja klawisza "metal" (dolny rząd, KRAWĘDZIE): stałe labele STOP/BACK (lewy) i PLAY/PAUSE (prawy) —
 * zmienia się wyłącznie podświetlenie. Środek rzędu zajmuje JOYSTICK (osobne pole `joystick` w configu).
 */
export type MetalKeyDef = { type: 'label'; upper: string; lower?: string; active?: boolean; lowerActive?: boolean; onPress?: () => void };
/**
 * Pełny układ klawiatury dla danego ekranu: 3 klawisze "screen" (górny rząd) + 2 "metal" (krawędzie
 * dolnego rzędu) + joystick (środek dolnego rzędu). Joystick ma WŁASNE pole — nie jest klawiszem REC,
 * tylko kontekstową kontrolką nawigacji (patrz Joystick.tsx).
 */
export type KeyboardConfig = { screen: ScreenKeyDef[]; metal: MetalKeyDef[]; joystick?: JoystickConfig };

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
  return (
    <MetalLabelKey upper={def.upper} lower={def.lower} active={def.active} lowerActive={def.lowerActive} onPress={def.onPress} />
  );
}

export function Keyboard({ config = EMPTY_KEYBOARD, keyIcons }: { config?: KeyboardConfig; keyIcons?: boolean }) {
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
              icons={keyIcons}
              icon={k.icon}
              onPress={k.onPress}
              onLongPress={k.onLongPress}
              onHoldComplete={k.onHoldComplete}
              onHoldStart={k.onHoldStart}
              holdMs={k.holdMs}
              progress={k.progress}
            />
          ))}
        </Row>
        {/* dolny rząd: metal[0] · JOYSTICK · metal[1] (środek to kontrolka nawigacji, nie klawisz) */}
        <Row>
          {config.metal[0] ? <MetalKey def={config.metal[0]} /> : <View style={{ width: dims.key.size, height: dims.key.size }} />}
          <Joystick config={config.joystick} />
          {config.metal[1] ? <MetalKey def={config.metal[1]} /> : <View style={{ width: dims.key.size, height: dims.key.size }} />}
        </Row>
      </Bevel>
    </View>
  );
}
