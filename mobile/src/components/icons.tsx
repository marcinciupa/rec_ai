/**
 * Ikony wektorowe przepisane z Figmy (assets/figma/*.svg) na react-native-svg.
 * Trzymane jako komponenty (nie pliki .svg), żeby parametryzować kolory/stany
 * bez konfiguracji transformera Metro.
 */
import Svg, {
  Circle,
  Path,
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import { color } from '../theme/tokens';

/** logo.svg — zaokrąglony kwadrat z okrągłym wycięciem (branding). 12×12 */
export function LogoIcon({ size = 12, fill = color.gray }: { size?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path
        d="M10 0C11.1046 0 12 0.895431 12 2V10C12 11.1046 11.1046 12 10 12H2C0.895431 12 0 11.1046 0 10V2C0 0.895431 0.895431 0 2 0H10ZM6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9C7.65685 9 9 7.65685 9 6C9 4.34315 7.65685 3 6 3Z"
        fill={fill}
      />
    </Svg>
  );
}

/** deapi.svg — znaczek "AI / deAPI" (chip z przekątną). 22×24, kolor phosphor. */
export function DeApiIcon({ size = 24, fill = color.phosphor }: { size?: number; fill?: string }) {
  return (
    <Svg width={(size * 22) / 24} height={size} viewBox="0 0 22 24" fill="none">
      <Path
        d="M17.5952 19.7333L18.4433 18.8852V16.6844H21.421V14.9882H18.4433V12.8485H21.421V11.1523H18.4433V9.01262H21.421V7.31644H18.4433V5.11566L17.5952 4.26757H15.3945V2.33733L13.6983 1.35779V4.26672H11.5586V0.122124L11.3465 0H10.0744L9.8624 0.122124V4.26672H7.72268V1.35779L6.0265 2.33733V4.26757H3.82572L2.97763 5.11566V7.31644H0V9.01262H2.97763V11.1523H0V12.8485H2.97763V14.9882H0V16.6844H2.97763V18.8852L3.82572 19.7333H6.0265V21.6627L7.72268 22.6422V19.7333H9.8624V23.8779L10.0744 24H11.3465L11.5586 23.8779V19.7333H13.6983V22.6422L15.3945 21.6627V19.7333H17.5952ZM4.6738 18.0371V5.9629H16.7472V18.0363L4.6738 18.0371ZM13.242 7.29694H15.3792L8.17555 16.7022H6.03838L13.242 7.29694Z"
        fill={fill}
      />
    </Svg>
  );
}

/**
 * led.svg — dioda 4×4. W spoczynku ciemna z metalicznym obrysem.
 * `recording` zapala ją na czerwono (glow dorobimy animacją później).
 */
export function LedIcon({
  size = 8,
  recording = false,
  strokeFrom = color.gray,
  strokeTo = '#FFFFFF',
}: {
  size?: number;
  recording?: boolean;
  strokeFrom?: string;
  strokeTo?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 4 4" fill="none">
      <Defs>
        <RadialGradient id="ledBase" cx="50%" cy="50%" r="70%">
          <Stop offset="0" stopColor={recording ? color.recordRed : color.dark21} />
          <Stop offset="1" stopColor={recording ? color.recordRedHot : color.dark1A} />
        </RadialGradient>
        <RadialGradient id="ledSheen" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.25" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.05" />
        </RadialGradient>
        <LinearGradient id="ledStroke" x1="0" y1="0" x2="4" y2="4" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={strokeFrom} />
          <Stop offset="1" stopColor={strokeTo} />
        </LinearGradient>
      </Defs>
      <Circle cx="2" cy="2" r="1.75" fill="url(#ledBase)" />
      <Circle cx="2" cy="2" r="1.75" fill="url(#ledSheen)" />
      <Circle cx="2" cy="2" r="1.75" stroke="url(#ledStroke)" strokeWidth="0.5" />
    </Svg>
  );
}

/** rewind_back.svg — podwójna strzałka wstecz (przycisk seek). 16×9 */
export function RewindBackIcon({ width = 16, fill = color.gray }: { width?: number; fill?: string }) {
  const h = (width * 9) / 16;
  return (
    <Svg width={width} height={h} viewBox="0 0 16 9" fill="none">
      <Path
        d="M3.55969 3.66395C2.9579 4.05888 2.9579 4.94112 3.55969 5.33605L7.5942 7.98369C8.25921 8.4201 9.14286 7.94306 9.14286 7.14765V1.85235C9.14286 1.05694 8.25921 0.579895 7.5942 1.01631L3.55969 3.66395Z"
        fill={fill}
      />
      <Path
        d="M10.4168 3.66395C9.81504 4.05888 9.81504 4.94112 10.4168 5.33605L14.4513 7.98369C15.1164 8.4201 16 7.94306 16 7.14765L16 1.85235C16 1.05694 15.1163 0.579895 14.4513 1.01631L10.4168 3.66395Z"
        fill={fill}
      />
      <Path
        d="M2.28571 1C2.28571 0.447715 1.838 0 1.28571 0H1C0.447715 0 0 0.447715 0 1V8C0 8.55228 0.447715 9 0.999999 9H1.28571C1.838 9 2.28571 8.55228 2.28571 8V1Z"
        fill={fill}
      />
    </Svg>
  );
}

/** rewind_fwd.svg — podwójna strzałka naprzód (przycisk seek). 16×9 */
export function RewindFwdIcon({ width = 16, fill = color.gray }: { width?: number; fill?: string }) {
  const h = (width * 9) / 16;
  return (
    <Svg width={width} height={h} viewBox="0 0 16 9" fill="none">
      <Path
        d="M12.4403 3.66395C13.0421 4.05888 13.0421 4.94112 12.4403 5.33605L8.4058 7.98369C7.74079 8.4201 6.85714 7.94306 6.85714 7.14765V1.85235C6.85714 1.05694 7.74079 0.579895 8.4058 1.01631L12.4403 3.66395Z"
        fill={fill}
      />
      <Path
        d="M5.58317 3.66395C6.18496 4.05888 6.18496 4.94112 5.58317 5.33605L1.54866 7.98369C0.883649 8.4201 0 7.94306 0 7.14765L0 1.85235C0 1.05694 0.88365 0.579895 1.54866 1.01631L5.58317 3.66395Z"
        fill={fill}
      />
      <Path
        d="M13.7143 1C13.7143 0.447715 14.162 0 14.7143 0H15C15.5523 0 16 0.447715 16 1V8C16 8.55228 15.5523 9 15 9H14.7143C14.162 9 13.7143 8.55228 13.7143 8V1Z"
        fill={fill}
      />
    </Svg>
  );
}

/** seek_arrow.svg — trójkąt (etykieta prędkości). `dir` obraca w lewo/prawo. 12×12 */
export function SeekArrowIcon({
  size = 12,
  fill = color.gray,
  dir = 'right',
}: {
  size?: number;
  fill?: string;
  dir?: 'left' | 'right';
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      style={dir === 'right' ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      {/* bazowy trójkąt wskazuje w LEWO (apex z lewej); dir='right' odbija w poziomie */}
      <Path d="M3.00003 6L9.00003 1.5L9.00003 10.5L3.00003 6Z" fill={fill} />
    </Svg>
  );
}
