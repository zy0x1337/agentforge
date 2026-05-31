/**
 * ProviderFilter.tsx
 * Checkbox-group filter for known GGUF providers.
 * Emits the currently selected provider IDs on every change.
 */

import React from 'react';
import { KNOWN_PROVIDERS } from '../../lib/providers';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export const ProviderFilter: React.FC<Props> = ({ selected, onChange }) => {
  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-text-muted)',
          paddingBottom: 'var(--space-1)',
        }}
      >
        Provider
      </span>

      {KNOWN_PROVIDERS.map((p) => {
        const active = selected.includes(p.id);
        return (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              transition: 'color var(--transition-interactive)',
            }}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => toggle(p.id)}
              style={{ accentColor: p.colorToken, width: 14, height: 14 }}
            />
            <span style={{ fontWeight: active ? 600 : 400 }}>{p.displayName}</span>
            {p.recommended && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-success)',
                  background: 'var(--color-success-highlight)',
                  borderRadius: 'var(--radius-full)',
                  padding: '0 5px',
                  fontWeight: 600,
                }}
              >
                ✓
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
};
