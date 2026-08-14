import { Music2, Volume2 } from 'lucide-react'
import { useState } from 'react'
import {
  getBgmVolume, getSeVolume, playButtonSound, setBgmVolume, setSeVolume,
} from '../services/soundService'

interface AudioControlsProps {
  compact?: boolean
}

export function AudioControls({ compact = false }: AudioControlsProps) {
  const [se, setSe] = useState(() => Math.round(getSeVolume() * 100))
  const [bgm, setBgm] = useState(() => Math.round(getBgmVolume() * 100))

  return <div className={`audio-controls ${compact ? 'compact' : ''}`} aria-label="音量設定">
    <label>
      <span><Volume2 size={compact ? 15 : 18} /> SE <b>{se}</b></span>
      <input
        type="range" min="0" max="100" step="1" value={se}
        aria-label="SE音量"
        onChange={(event) => {
          const value = Number(event.target.value)
          setSe(value)
          setSeVolume(value / 100)
        }}
        onPointerUp={() => playButtonSound()}
      />
    </label>
    <label>
      <span><Music2 size={compact ? 15 : 18} /> BGM <b>{bgm}</b></span>
      <input
        type="range" min="0" max="100" step="1" value={bgm}
        aria-label="BGM音量"
        onChange={(event) => {
          const value = Number(event.target.value)
          setBgm(value)
          setBgmVolume(value / 100)
        }}
      />
    </label>
  </div>
}
