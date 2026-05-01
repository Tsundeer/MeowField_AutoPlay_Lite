import React from 'react'

import type { GameProfile } from '../api/ws'

type VirtualKeyboardProps = {
  activeKeys: Set<string>
  gameProfile?: GameProfile | null
}

type LayoutKey = {
  key: string
  note?: number
}

type LayoutRow = {
  keys: LayoutKey[]
  small?: boolean
  label?: string
}

const DEFAULT_LAYOUT: LayoutRow[] = [
  { keys: ['1', '2', '3', '4', '5', '6', '7'].map((key) => ({ key })) },
  { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'].map((key) => ({ key })) },
  { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map((key) => ({ key })) },
  { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((key) => ({ key })), small: true },
]

const IDENTITY_V_LAYOUT: LayoutRow[] = [
  { keys: ['2', '3', '5', '6', '7'].map((key) => ({ key })), small: true },
  { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'].map((key) => ({ key })) },
  { keys: ['S', 'D', 'G', 'H', 'J'].map((key) => ({ key })), small: true },
  { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((key) => ({ key })) },
  { keys: ['L', ';', '9', '0', '-'].map((key) => ({ key })), small: true },
  { keys: [',', '.', '/', 'I', 'O', 'P', '['].map((key) => ({ key })) },
]

function getSortedKeyEntries(gameProfile?: GameProfile | null): Array<{ note: number; key: string }> {
  return Object.entries(gameProfile?.custom_key_map || {})
    .map(([note, key]) => ({ note: Number(note), key: String(key).toUpperCase() }))
    .sort((a, b) => a.note - b.note)
}

function splitWhiteAndBlackKeys(entries: Array<{ note: number; key: string }>) {
  const whitePitchClasses = new Set([0, 2, 4, 5, 7, 9, 11])
  return {
    whiteKeys: entries.filter((item) => whitePitchClasses.has(item.note % 12)),
    blackKeys: entries.filter((item) => !whitePitchClasses.has(item.note % 12)),
  }
}

function getYihuanLayout(gameProfile?: GameProfile | null): LayoutRow[] {
  const entries = getSortedKeyEntries(gameProfile)
  if (entries.length === 0) {
    return [
      { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'].map((key) => ({ key })) },
      { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map((key) => ({ key })) },
      { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((key) => ({ key })) },
    ]
  }

  // 异环的半音是通过 Shift / Ctrl 组合键触发的，必须按真实音高分组展示。
  const bands = [
    { label: '高音', min: 72, max: 84 },
    { label: '中音', min: 60, max: 71 },
    { label: '低音', min: 47, max: 59 },
  ]

  return bands.flatMap(({ label, min, max }) => {
    const bandEntries = entries.filter((item) => item.note >= min && item.note <= max)
    const { whiteKeys, blackKeys } = splitWhiteAndBlackKeys(bandEntries)
    return [
      {
        label,
        keys: blackKeys.map((item) => ({ key: item.key, note: item.note })),
        small: true,
      },
      {
        keys: whiteKeys.map((item) => ({ key: item.key, note: item.note })),
      },
    ]
  })
}

function getLayout(gameProfile?: GameProfile | null): LayoutRow[] {
  if (gameProfile?.id?.startsWith('identity-v-')) {
    return IDENTITY_V_LAYOUT
  }
  if (gameProfile?.id?.startsWith('yihuan-')) {
    return getYihuanLayout(gameProfile)
  }
  return DEFAULT_LAYOUT
}

function getKeys(gameProfile?: GameProfile | null): string[] {
  return getLayout(gameProfile).flatMap((row) => row.keys.map((item) => item.key))
}

function displayKeyText(key: string): string {
  const parts = key.toUpperCase().split('+')
  return parts[parts.length - 1] || key.toUpperCase()
}

function modifierText(key: string): string {
  const parts = key.toUpperCase().split('+')
  if (parts.length <= 1) {
    return ''
  }
  return parts.slice(0, -1).join('+')
}

function labelForKey(item: LayoutKey, gameProfile?: GameProfile | null): string {
  if (item.note != null) {
    return String(item.note)
  }
  const entries = Object.entries(gameProfile?.custom_key_map || {})
  const hit = entries.find(([, mapped]) => String(mapped).toUpperCase() === item.key.toUpperCase())
  return hit ? `${hit[0]}` : item.key
}

export function VirtualKeyboard({ activeKeys, gameProfile }: VirtualKeyboardProps) {
  const layout = getLayout(gameProfile)
  const allKeys = new Set(getKeys(gameProfile).map((key) => key.toUpperCase()))
  const normalizedActiveKeys = new Set([...activeKeys].map((key) => key.toUpperCase()))

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>虚拟键盘</span>
        <span style={styles.subtitle}>{gameProfile?.name || '当前游戏布局'}</span>
      </div>
      <div style={styles.keyboard}>
        {layout.map((row, rowIndex) => (
          <div key={rowIndex} style={styles.rowGroup}>
            {row.label ? <div style={styles.rowLabel}>{row.label}</div> : <div style={styles.rowLabelSpacer} />}
            <div style={{ ...styles.row, ...(row.small ? styles.smallRow : null) }}>
              {row.keys.map((item) => {
                const isActive = normalizedActiveKeys.has(item.key.toUpperCase())
                const modifier = modifierText(item.key)
                return (
                  <div
                    key={`${item.key}-${item.note ?? 'key'}`}
                    style={{
                      ...styles.key,
                      ...(row.small ? styles.smallKey : styles.bigKey),
                      ...(isActive ? styles.activeKey : styles.inactiveKey),
                    }}
                  >
                    {modifier ? (
                      <div style={{ ...styles.modifierText, color: isActive ? 'rgba(255,255,255,0.82)' : '#d8c7ae' }}>
                        {modifier}
                      </div>
                    ) : (
                      <div style={styles.modifierSpacer} />
                    )}
                    <div style={{ ...styles.keyText, color: isActive ? '#fff' : '#f3e6d0' }}>
                      {displayKeyText(item.key)}
                    </div>
                    <div style={{ ...styles.keyLabel, color: isActive ? 'rgba(255,255,255,0.85)' : '#bda98d' }}>
                      {labelForKey(item, gameProfile)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={styles.footer}>
        <span style={styles.footerText}>
          {gameProfile?.id?.startsWith('yihuan-') ? '异环黑键使用 Shift 或 Ctrl 组合键。' : '右上高音，左下低音。'}
        </span>
        <span style={styles.footerText}>
          当前显示按键：{[...normalizedActiveKeys].filter((key) => allKeys.has(key)).join(' ') || '无'}
        </span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    borderRadius: '16px',
    background: 'linear-gradient(180deg, #3b2e24 0%, #201915 100%)',
    border: '1px solid #5b4a39',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '16px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#f8e7c5',
  },
  subtitle: {
    fontSize: '12px',
    color: '#c7b497',
  },
  keyboard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  rowGroup: {
    display: 'grid',
    gridTemplateColumns: '56px minmax(0, 1fr)',
    alignItems: 'center',
    gap: '10px',
  },
  rowLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#f3e6d0',
    textAlign: 'center',
    padding: '8px 6px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.08)',
  },
  rowLabelSpacer: {
    height: '1px',
  },
  row: {
    display: 'flex',
    justifyContent: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  smallRow: {
    gap: '14px',
  },
  key: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    border: '1px solid #8e775f',
    boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.06)',
  },
  bigKey: {
    width: '72px',
    height: '72px',
  },
  smallKey: {
    width: '52px',
    height: '52px',
  },
  inactiveKey: {
    background: 'radial-gradient(circle at 30% 30%, #4f4033 0%, #2a221c 70%)',
  },
  activeKey: {
    background: 'radial-gradient(circle at 30% 30%, #c89f5e 0%, #8c6738 70%)',
    transform: 'scale(0.96)',
  },
  modifierText: {
    fontSize: '9px',
    lineHeight: 1.1,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  modifierSpacer: {
    height: '10px',
  },
  keyText: {
    fontSize: '20px',
    fontWeight: 700,
    lineHeight: 1,
  },
  keyLabel: {
    fontSize: '10px',
    marginTop: '4px',
    fontFamily: 'ui-monospace, monospace',
  },
  footer: {
    marginTop: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  footerText: {
    fontSize: '12px',
    color: '#c7b497',
  },
}
