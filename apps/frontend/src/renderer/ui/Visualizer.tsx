import React, { useEffect, useMemo, useRef } from 'react'

import type { GameProfile } from '../api/ws'

interface VisualizerProps {
  activeKeys: Set<string>
  gameProfile?: GameProfile | null
  width?: number
  height?: number
}

const DEFAULT_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', '1', '2', '3', '4', '5', '6', '7']
const IDENTITY_V_KEYS = [',', 'L', '.', ';', '/', 'I', '9', 'O', '0', 'P', '-', '[', 'Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M', 'Q', '2', 'W', '3', 'E', 'R', '5', 'T', '6', 'Y', '7', 'U']

function getOrderedKeys(gameProfile?: GameProfile | null): string[] {
  if (gameProfile?.id?.startsWith('identity-v-')) {
    return IDENTITY_V_KEYS
  }

  const customMapEntries = Object.entries(gameProfile?.custom_key_map || {})
    .map(([note, key]) => ({ note: Number(note), key: String(key).toUpperCase() }))
    .sort((a, b) => a.note - b.note)

  if (customMapEntries.length > 0) {
    return customMapEntries.map((item) => item.key)
  }

  return DEFAULT_KEYS
}

export function Visualizer({ activeKeys, gameProfile, width = 600, height = 200 }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const normalizedActiveKeys = useMemo(
    () => new Set([...activeKeys].map((key) => key.toUpperCase())),
    [activeKeys],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const orderedKeys = getOrderedKeys(gameProfile)

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      ctx.fillStyle = '#1a1410'
      ctx.fillRect(0, 0, width, height)

      const gap = 6
      const barWidth = Math.max(10, Math.floor((width - (orderedKeys.length - 1) * gap) / orderedKeys.length))
      const maxHeight = height - 32

      orderedKeys.forEach((key, index) => {
        const x = index * (barWidth + gap)
        const isActive = normalizedActiveKeys.has(key.toUpperCase())
        const barHeight = isActive ? maxHeight * 0.82 : maxHeight * 0.18

        const gradient = ctx.createLinearGradient(x, height - 12, x, height - 12 - barHeight)
        if (isActive) {
          gradient.addColorStop(0, '#d4a35f')
          gradient.addColorStop(1, '#f7d9a1')
        } else {
          gradient.addColorStop(0, '#544437')
          gradient.addColorStop(1, '#7a644f')
        }

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, height - 12 - barHeight, barWidth, barHeight, 4)
        ctx.fill()
      })

      requestAnimationFrame(draw)
    }

    draw()
  }, [gameProfile, height, normalizedActiveKeys, width])

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #2c2118 0%, #130e0a 100%)',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid #4a392d',
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    </div>
  )
}
