import { useEffect, useState } from 'react'
import { ensureAnonymousUser, registerPresence, subscribeRoom, subscribeSecret } from '../services/roomService'
import type { Room } from '../types/game'

export function useGameRoom(roomId: string | null) {
  const [uid, setUid] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [secretNumber, setSecretNumber] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      setSecretNumber(null)
      return
    }
    let unsubscribeRoom: () => void = () => undefined
    let unsubscribeSecret: () => void = () => undefined
    let cancelled = false
    void ensureAnonymousUser()
      .then(async (user) => {
        if (cancelled) return
        setUid(user.uid)
        unsubscribeRoom = subscribeRoom(roomId, (nextRoom) => {
          setRoom(nextRoom)
          if (!nextRoom) setError('部屋が削除されたか、アクセスできません。')
        })
        unsubscribeSecret = subscribeSecret(roomId, user.uid, setSecretNumber)
        await registerPresence(roomId, user.uid)
      })
      .catch(() => setError('Firebaseに接続できませんでした。設定と通信環境をご確認ください。'))
    return () => {
      cancelled = true
      unsubscribeRoom()
      unsubscribeSecret()
    }
  }, [roomId])

  return { uid, room, secretNumber, error, setError }
}
