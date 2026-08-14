import { useEffect, useRef } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { Player } from '../types/game'
import { playReorderSound } from '../services/soundService'

interface SortableOrderProps {
  ids: string[]
  players: Record<string, Player>
  editable: boolean
  onChange: (ids: string[]) => void
}

function SortableCard({ id, player, index, editable }: { id: string; player: Player; index: number; editable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editable })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`order-card ${isDragging ? 'dragging' : ''}`}
    >
      <span className="rank">{index + 1}</span>
      <span className="avatar small">{player.name.slice(0, 1).toUpperCase()}</span>
      <strong>{player.name}</strong>
      {player.hint && <span className="player-hint">{player.hint}</span>}
      {editable && (
        <button className="drag-handle" type="button" aria-label={`${player.name}を並べ替える`} {...attributes} {...listeners}>
          <GripVertical size={24} />
        </button>
      )}
    </li>
  )
}

export function SortableOrder({ ids, players, editable, onChange }: SortableOrderProps) {
  const previousOrder = useRef(ids.join('|'))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  useEffect(() => {
    const currentOrder = ids.join('|')
    if (!editable && previousOrder.current !== currentOrder) playReorderSound()
    previousOrder.current = currentOrder
  }, [editable, ids])

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex >= 0 && newIndex >= 0) {
      playReorderSound()
      onChange(arrayMove(ids, oldIndex, newIndex))
    }
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="order-list">
          {ids.map((id, index) => players[id] && <SortableCard key={id} id={id} player={players[id]} index={index} editable={editable} />)}
        </ol>
      </SortableContext>
    </DndContext>
  )
}
