import { holdTime } from '../pose/scoreDisplay';

export default function HoldTimer({durationMs}:{durationMs:number}) {
  return <span className="hold-timer" aria-label="Hold duration">
    <strong>{holdTime(durationMs)}</strong><span>Hold</span>
  </span>;
}
