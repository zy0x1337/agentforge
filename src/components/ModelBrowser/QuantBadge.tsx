/**
 * QuantBadge.tsx
 * Small badge showing the quantisation tag with quality-tier colour
 * and a hover tooltip with full metadata.
 */

import React from 'react';
import { getQuantInfo, tierColorToken, type QuantLevel } from '../../lib/quantParser';

interface Props {
  tag: QuantLevel;
  /** Show VRAM estimate next to badge */
  vramGb?: number;
  /** Show BPW next to badge */
  showBpw?: boolean;
  size?: 'sm' | 'md';
}

export const QuantBadge: React.FC<Props> = ({
  tag,
  vramGb,
  showBpw = false,
  size = 'md',
}) => {
  const info = getQuantInfo(tag);
  const color = tierColorToken(info.qualityTier);

  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';
  const padding = size === 'sm' ? '1px 6px' : '2px 8px';

  return (
    <span
      title={`${info.description}\n${info.useCase}\nBits/weight: ${info.bpw}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize,
        fontFamily: 'var(--font-mono, monospace)',
        fontWeight: 600,
        color,
        background: `color-mix(in oklch, ${color} 12%, var(--color-surface))`,
        border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
        borderRadius: 'var(--radius-sm)',
        padding,
        whiteSpace: 'nowrap',
        cursor: 'help',
        userSelect: 'none',
      }}
    >
      {info.label}
      {showBpw && (
        <span style={{ opacity: 0.65, fontWeight: 400 }}>{info.bpw}bpw</span>
      )}
      {vramGb != null && vramGb > 0 && (
        <span style={{ opacity: 0.65, fontWeight: 400 }}>{vramGb}GB</span>
      )}
    </span>
  );
};
