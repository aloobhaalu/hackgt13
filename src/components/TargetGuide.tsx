import { TARGET } from '../config';

export default function TargetGuide({visible}:{visible:boolean}) {
  return <div className="target-guide" data-visible={visible} aria-hidden="true" style={{transitionDuration:`${TARGET.fadeMs}ms`}}>
    <svg viewBox="0 0 100 100" fill="none"><ellipse cx="50" cy="50" rx="24" ry="43" vectorEffect="non-scaling-stroke"/></svg>
  </div>;
}
