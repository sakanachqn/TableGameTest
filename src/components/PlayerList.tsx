import { Crown, WifiOff } from 'lucide-react'
import { displayPlayers } from '../game/rules'
import type { Room } from '../types/game'

interface PlayerListProps {
  room: Room
  currentUid: string
}

export function PlayerList({ room, currentUid }: PlayerListProps) {
  return (
    <div className="player-grid" aria-label="参加者一覧">
      {displayPlayers(room.players).map(([uid, player]) => (
        <div className={`player-chip ${player.connected ? '' : 'offline'}`} key={uid}>
          <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
          <span className="player-name">{player.name}{uid === currentUid && <small>あなた</small>}</span>
          {uid === room.meta.hostUid && <Crown size={18} aria-label="ホスト" />}
          {!player.connected && <WifiOff size={16} aria-label="切断中" />}
          {player.eligibleFromRound > room.meta.round && room.meta.phase !== 'lobby' && <small className="waiting">次から</small>}
        </div>
      ))}
    </div>
  )
}
