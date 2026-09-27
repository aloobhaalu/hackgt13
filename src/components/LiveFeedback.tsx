import type { CameraView, ExerciseId } from '../config';
import type { Assessment } from '../pose/types';
import { coachingText } from '../pose/coachingText';

export default function LiveFeedback({assessment,exercise,view}:{assessment:Assessment;exercise:ExerciseId;view:CameraView}) {
  const {prompt,cues}=coachingText(assessment,exercise,view);
  const messages=[...(prompt?[prompt]:[]),...cues].slice(0,4);
  if(!messages.length)return null;
  return <div className="live-feedback" aria-label="Live coaching" aria-live="polite" aria-atomic="true">
    {messages.length===1?<p>{messages[0]}</p>:<ul className={messages.length>2?'has-columns':undefined}>{messages.map(message=><li key={message}>{message}</li>)}</ul>}
  </div>;
}
