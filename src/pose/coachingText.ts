import type { CameraView, ExerciseId } from '../config';
import type { Assessment, Correction } from './types';
import { alignmentText } from './scoreDisplay';

// Use the same confirmed local issues as the visual overlays
// Gemini never writes live coaching cues
function correctionText(c:Correction,exercise:ExerciseId,a:Assessment):string|null {
  const id=c.id;
  if(id.startsWith('elbow-motion'))return 'Keep your elbows still as you curl';
  if(id.startsWith('elbow-')||id==='upper-arm')return 'Keep your elbows close to your torso';
  if(id.startsWith('hand-path'))return 'Bring your hands inward toward your shoulders';
  if(id==='forearm-path')return 'Curl your hands forward and up';
  if(id.startsWith('bottom-range'))return 'Lower your arms fully before the next curl';
  if(id.startsWith('curl-range'))return 'Curl a little higher toward your shoulders';
  if(id==='arm-symmetry')return 'Move both arms through a similar range';
  if(id==='torso')return exercise==='curl'?'Keep your torso still and upright':'Bring your chest more upright';
  if(id==='hip-shift')return 'Keep your hips still as you curl';
  if(id==='trunk-swing')return 'Slow down and keep your torso still';
  if(id==='depth')return 'Lower your hips a little further';
  if(id==='heel-lift')return 'Bring your heels back down';
  if(id.startsWith('stance-wide'))return 'Bring your feet closer together';
  if(id.startsWith('stance-narrow'))return 'Move your feet a little farther apart';
  if(id.startsWith('toe-direction'))return 'Turn your feet toward the green targets';
  if(id.startsWith('knee-track'))return 'Guide your knees toward the green targets';
  if(id==='leg-symmetry')return 'Keep your knees moving evenly';
  if(id==='foot-symmetry')return 'Line up your feet evenly';
  if(id==='balance')return exercise==='plank'?'Center your hips between your hands':'Center your hips between your feet';
  if(id==='hip-line')return (a.debug.angles.hipLineOffset??0)>0?'Lift your hips toward the green line':'Lower your hips toward the green line';
  if(id==='knee-line')return 'Straighten your legs toward the green line';
  if(id==='hand-stack')return 'Bring your hands closer beneath your shoulders';
  if(id==='level-11')return 'Keep your shoulders level';
  if(id==='level-23')return 'Keep your hips level';
  if(id==='level-15')return 'Line up your hands evenly';
  if(id==='level-27')return 'Line up your feet evenly';
  if(id==='control')return 'Slow the curl and control the movement';
  if(id==='stability'||id.startsWith('stability-'))return exercise==='plank'?'Hold your body steadier':'Slow down and keep the movement steady';
  return null;
}

export function coachingText(a:Assessment,exercise:ExerciseId,view:CameraView) {
  const status=alignmentText(a);
  const setup:Record<string,string>={
    'Tracking unclear':exercise==='curl'?'Keep your head, shoulders, elbows, hands and hips visible':'Keep your full body visible to the camera',
    'Adjust camera':view==='front'?'Face the camera for this view':'Turn sideways to the camera for this view',
    'Hold still':exercise==='curl'?'Stand with your arms down until Ready appears':'Stand upright until Ready appears',
    'Lower your arms':'Stand upright with your arms relaxed at your sides',
    'Stand tall':'Return to standing before starting a squat',
    Lowering:'Keep lowering with control',
    'Get into position':exercise==='plank'?'Set up with your hands and toes supporting you':exercise==='curl'?'Stand upright with your arms down':'Return to standing before starting a squat',
    Ready:exercise==='curl'?'Ready for your next curl':exercise==='squat'?'Ready for your next squat':'Set up your plank when ready',
  };
  const cues=a.ready&&a.debug.coachingEnabled===true&&a.debug.viewValid===true
    ? [...new Set((a.corrections??[]).map(c=>correctionText(c,exercise,a)).filter((text):text is string=>text!==null))]:[];
  return {status,prompt:a.score===null?setup[status]??'Get into your starting position':null,cues};
}
