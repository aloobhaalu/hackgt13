import type { ExerciseId } from '../config';
import type { Assessment } from '../pose/types';
import { holdTime } from '../pose/scoreDisplay';

export default function RepCounter({exercise,assessment:a}:{exercise:ExerciseId;assessment:Assessment}) {
  const completed=a.debug.completedCycles??0;
  return <span className="rep-count" aria-label={exercise==='plank'?'Hold duration':`${completed} Reps, ${a.reps} Quality Reps`}>
    <strong>{exercise==='plank'?holdTime(a.holdMs??0):String(completed).padStart(2,'0')}</strong>
    <span>{exercise==='plank'?'Hold':<>Reps / {a.reps} Quality Reps</>}</span>
  </span>;
}
