import React, { useState } from 'react'

interface MidiNote {
  start_ms: number
  end_ms: number
  note: number
  velocity: number
}

interface MidiEditorProps {
  notes: MidiNote[]
  durationMs: number
  onNotesChange?: (notes: MidiNote[]) => void
}

export function MidiEditor({ notes, durationMs, onNotesChange }: MidiEditorProps) {
  const [selectedNote, setSelectedNote] = useState<number | null>(null)

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${sec.toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`
  }

  const deleteNote = (index: number) => {
    const newNotes = notes.filter((_, i) => i !== index)
    onNotesChange?.(newNotes)
  }

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '16px'
    }}>
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        color: '#1f2937',
        marginBottom: '16px'
      }}>
        MIDI 编辑器 (开发中...)
      </div>
      <div style={{
        background: '#f9fafb',
        borderRadius: '8px',
        padding: '12px',
        border: '1px solid #e5e7eb',
        fontSize: '13px',
        color: '#6b7280'
      }}>
        <div>MIDI 编辑功能开发中...</div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
          • 钢琴卷帘视图
        </div>
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
          • 音符选择和编辑
        </div>
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
          • 时长调整
        </div>
      </div>
      <div style={{ marginTop: '12px' }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 500,
          color: '#374151',
          marginBottom: '8px'
        }}>
          音符列表 ({notes.length})
        </div>
        <div style={{ maxHeight: '200px', overflow: 'auto' }}>
          {notes.slice(0, 20).map((note, index) => (
            <div
              key={index}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #f3f4f6',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: selectedNote === index ? '#dbeafe' : 'transparent',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
              onClick={() => setSelectedNote(index)}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
                  音符 {note.note}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {formatTime(note.start_ms)} - {formatTime(note.end_ms)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteNote(index)
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  background: '#fee2e2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
