type SoundKey = 'topic' | 'button' | 'ordering' | 'reorder' | 'result'

interface SoundDefinition {
  src: string
  volume: number
  poolSize: number
}

const SOUNDS: Record<SoundKey, SoundDefinition> = {
  topic: { src: '/audio/se/topic-reveal.mp3', volume: 0.9, poolSize: 2 },
  button: { src: '/audio/se/button.mp3', volume: 0.72, poolSize: 4 },
  ordering: { src: '/audio/se/ordering-start.mp3', volume: 0.9, poolSize: 2 },
  reorder: { src: '/audio/se/reorder.mp3', volume: 0.82, poolSize: 4 },
  result: { src: '/audio/se/result-reveal.mp3', volume: 0.92, poolSize: 2 },
}

const pools = new Map<SoundKey, HTMLAudioElement[]>()
const nextIndexes: Record<SoundKey, number> = { topic: 0, button: 0, ordering: 0, reorder: 0, result: 0 }
const legacySoundEnabled = localStorage.getItem('kokoro-sound') !== 'off'
let seVolume = Number(localStorage.getItem('kokoro-se-volume') ?? (legacySoundEnabled ? 0.85 : 0))
let bgmVolume = Number(localStorage.getItem('kokoro-bgm-volume') ?? (legacySoundEnabled ? 0.28 : 0))
let bgmAudio: HTMLAudioElement | null = null
let bgmRequested = false
let lastTopicAt = 0
let lastOrderingAt = 0
let lastResultKey = ''

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0))
}

seVolume = clampVolume(seVolume)
bgmVolume = clampVolume(bgmVolume)

function ensurePool(key: SoundKey): HTMLAudioElement[] {
  const existing = pools.get(key)
  if (existing) return existing
  const definition = SOUNDS[key]
  const pool = Array.from({ length: definition.poolSize }, () => {
    const audio = new Audio(definition.src)
    audio.preload = 'auto'
    audio.volume = definition.volume * seVolume
    return audio
  })
  pools.set(key, pool)
  return pool
}

function preloadSounds(): void {
  ;(Object.keys(SOUNDS) as SoundKey[]).forEach((key) => {
    ensurePool(key).forEach((audio) => audio.load())
  })
}

function ensureBgm(): HTMLAudioElement {
  if (bgmAudio) return bgmAudio
  bgmAudio = new Audio('/audio/bgm/game-loop.mp3')
  bgmAudio.preload = 'auto'
  bgmAudio.loop = true
  bgmAudio.volume = bgmVolume
  return bgmAudio
}

function tryStartBgm(): void {
  if (bgmVolume <= 0 || !bgmRequested) return
  void ensureBgm().play().catch(() => undefined)
}

function playSound(key: SoundKey): void {
  if (seVolume <= 0) return
  const pool = ensurePool(key)
  const available = pool.find((audio) => audio.paused || audio.ended)
  const audio = available ?? pool[nextIndexes[key] % pool.length]
  nextIndexes[key] = (nextIndexes[key] + 1) % pool.length
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

export function getSeVolume(): number {
  return seVolume
}

export function setSeVolume(volume: number): void {
  seVolume = clampVolume(volume)
  localStorage.setItem('kokoro-se-volume', String(seVolume))
  pools.forEach((pool, key) => {
    pool.forEach((audio) => { audio.volume = SOUNDS[key].volume * seVolume })
  })
}

export function getBgmVolume(): number {
  return bgmVolume
}

export function setBgmVolume(volume: number): void {
  bgmVolume = clampVolume(volume)
  localStorage.setItem('kokoro-bgm-volume', String(bgmVolume))
  const audio = ensureBgm()
  audio.volume = bgmVolume
  if (bgmVolume <= 0) audio.pause()
  else tryStartBgm()
}

export function startBgm(): void {
  bgmRequested = true
  ensureBgm().load()
  tryStartBgm()
}

export function stopBgm(): void {
  bgmRequested = false
  if (!bgmAudio) return
  bgmAudio.pause()
  bgmAudio.currentTime = 0
}

export function playButtonSound(): void {
  playSound('button')
}

export function playTopicSound(): void {
  if (seVolume <= 0) return
  const now = Date.now()
  if (now - lastTopicAt < 1000) return
  lastTopicAt = now
  playSound('topic')
}

export function playOrderingStartSound(): void {
  if (seVolume <= 0) return
  const now = Date.now()
  if (now - lastOrderingAt < 1000) return
  lastOrderingAt = now
  playSound('ordering')
}

export function playReorderSound(): void {
  playSound('reorder')
}

export function playResultSound(resultKey: string): void {
  if (lastResultKey === resultKey) return
  lastResultKey = resultKey
  playSound('result')
}

export function installGlobalButtonSounds(): () => void {
  const prepare = () => {
    preloadSounds()
    tryStartBgm()
  }
  const handleClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      tryStartBgm()
      playButtonSound()
    }
  }
  window.addEventListener('pointerdown', prepare, { once: true })
  window.addEventListener('click', handleClick)
  return () => {
    window.removeEventListener('pointerdown', prepare)
    window.removeEventListener('click', handleClick)
  }
}
