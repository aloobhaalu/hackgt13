import { EXERCISES, FRONT_SQUAT as F, TRACKING, VIEW, type CameraView, type ExerciseId } from '../config';
import type { Assessment, Correction, Point, Pose, ScoreComponent } from './types';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) });
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function angle(a: Point, b: Point, c: Point) {
  const u = [a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0)], v = [c.x-b.x,c.y-b.y,(c.z??0)-(b.z??0)];
  const d = Math.hypot(...u)*Math.hypot(...v);
  return d > 1e-8 ? Math.acos(Math.max(-1,Math.min(1,u.reduce((s,x,i)=>s+x*v[i],0)/d)))*180/Math.PI : NaN;
}

/** Separate metrics for front squat, curl views and plank views. No side squat penalties leak here. */
export class ViewCoach {
  private state = 'FRAME_INVALID';
  private since: number | null = null;
  private viewSince: number | null = null;
  private phaseSince: number | null = null;
  private started = 0;
  private at: number | null = null;
  private reps = 0;
  private source: 'world' | 'image' | null = null;
  private holdHeight: number | null = null;
  private baseline: { height: number; knee: number; torso: number; leg: number; elbows: number[]; feet: Point[] } | null = null;
  private history: { at: number; height: number; joint: number; center: Point }[] = [];
  private errors = new Map<string, number>();
  constructor(private id: ExerciseId, private view: CameraView) {}
  reset() { this.state='FRAME_INVALID'; this.since=null; this.phaseSince=null; this.viewSince=null; this.at=null; this.baseline=null; this.history=[]; this.errors.clear(); this.source=null; this.holdHeight=null; }

  update(pose: Pose, now: number, aspect: number, side: number, base: Assessment, world?: Pose): Assessment {
    if (this.at !== null && (now-this.at > EXERCISES.squat.maxFrameGapMs || now<=this.at)) this.reset();
    const dt = this.at === null ? 0 : (now-this.at)/1000; this.at=now;
    const p=pose.map(v=>({...v,x:v.x*aspect,z:0}));
    const s=side, shoulder=11+s, elbow=13+s, wrist=15+s, h=23+s, knee=25+s, ankle=27+s;
    const sh=this.view==='side'?p[shoulder]:mid(p[11],p[12]), hip=this.view==='side'?p[h]:mid(p[23],p[24]), foot=this.view==='side'?p[ankle]:mid(p[27],p[28]);
    const torso=dist(p[shoulder],p[h]);
    const shoulderWidth=dist(p[11],p[12]);
    const spread=Math.abs(p[11].x-p[12].x)/Math.max(torso,1e-6);
    const viewValid=this.view==='side' ? spread<=VIEW.sideMaxSpread : spread>=VIEW.frontMinSpread;
    const components: ScoreComponent[]=[], candidates: Correction[]=[];
    const angles: Record<string,number>={ shoulderSpread:spread };
    const add=(id:string,value:number,limit:number,range:number,joint:number,anchor:number,target:Point,kind:Correction['kind']='translation')=>{
      const error=Math.max(0,(value-limit)/range);
      components.push({id,value,limit,error,score:100*(1-clamp(error))});
      if(error>0) candidates.push({id,label:'',joint,anchor,target:{...target,x:target.x/aspect},severity:error,kind});
    };
    let reason='Waiting for exercise position', evaluating=false;
    const output=():Assessment=>{
      for(const id of this.errors.keys()) if(!evaluating || !candidates.some(c=>c.id===id)) this.errors.delete(id);
      for(const c of candidates) if(!this.errors.has(c.id)) this.errors.set(c.id,now);
      const corrections=evaluating ? candidates.filter(c=>now-this.errors.get(c.id)!>=TRACKING.errorHoldMs):[];
      const rawScore=evaluating && components.length ? components.reduce((v,c)=>v+c.score!,0)/components.length:null;
      return {...base,ready:true,score:rawScore===null?null:Math.round(rawScore),reps:this.reps,reason,corrections,correction:corrections[0]??null,
        phase:this.state==='HOLDING'||this.state==='TOP'?'Hold':this.state==='DESCENDING'?'Lower':this.state==='ASCENDING'?'Rise':this.state==='CURLING_UP'?'Curl':this.state==='LOWERING'?'Release':'Ready',
        debug:{...base.debug,exercise:this.id,view:this.view,state:this.state,viewValid,angles,components:evaluating?components:[],reason,validMovement:evaluating,rawScore,stableFrames:this.history.length}};
    };
    if(!Number.isFinite(torso)||torso<1e-5||!viewValid) {
      this.reset(); reason='Selected camera view not confirmed'; return output();
    }
    this.viewSince??=now;
    if(now-this.viewSince<VIEW.confirmMs) { reason='Confirming selected camera view'; return output(); }
    const previous=this.history.at(-1);
    const relevant=this.id==='curl'?[11,13,15,23]:this.id==='plank'?[11,13,15,23,25,27]:[11,23,25,27];
    const required=this.view==='side'?relevant.map(i=>i+s):relevant.flatMap(i=>[i,i+1]);
    const worldOK=world && required.every(i=>world[i]&&world[i].visibility>=TRACKING.visibility&&[world[i].x,world[i].y,world[i].z].every(Number.isFinite));
    const source=worldOK?'world':'image';
    if(this.source && this.source!==source){this.reset();reason='Geometry source changed; reacquire starting position';return output();}
    this.source=source;
    const g=worldOK?world!:p;
    const leftArm=angle(g[11],g[13],g[15]), rightArm=angle(g[12],g[14],g[16]);
    const kneeAngle=this.view==='side'?angle(g[h],g[knee],g[ankle]):(angle(g[23],g[25],g[27])+angle(g[24],g[26],g[28]))/2;
    const joint=this.id==='curl'?(this.view==='front'?(leftArm+rightArm)/2:angle(g[shoulder],g[elbow],g[wrist])):kneeAngle;
    const leg=(dist(p[23],p[25])+dist(p[25],p[27])+dist(p[24],p[26])+dist(p[26],p[28]))/2;
    const height=this.id==='curl'?(hip.y-sh.y)/torso:(foot.y-hip.y)/Math.max(this.baseline?.leg ?? leg,1e-5);
    const center=this.id==='curl'?sh:hip;
    this.history.push({at:now,height,joint,center});
    while(this.history.length>1&&now-this.history[0].at>EXERCISES.plank.holdMs) this.history.shift();
    const range=(key:'height'|'joint')=>Math.max(...this.history.map(f=>f[key]))-Math.min(...this.history.map(f=>f[key]));
    const motion=this.history.length>1?Math.max(...this.history.map(f=>dist(center,f.center)))/torso:0;
    const speed=previous&&dt>0?(joint-previous.joint)/dt:0;
    angles.joint=joint; angles.motion=motion; angles.angularSpeed=speed;
    if(!Number.isFinite(joint)||!Number.isFinite(height)) {this.reset();reason='Joint geometry unavailable';return output();}

    if(this.id==='curl') {
      const C=EXERCISES.curl;
      const upright=p[shoulder].y<p[h].y && (p[h].y-p[shoulder].y)/torso>0.6;
      const armDown=p[elbow].y>p[shoulder].y;
      if(!upright||!armDown) {this.reset();reason='Waiting for standing curl position';return output();}
      if(this.state==='FRAME_INVALID') this.state='READY';
      const drift=(i:number)=>Math.abs(p[i].x-p[i-2].x)/torso;
      if(!this.baseline) {
        const extended=this.view==='front'?Math.min(leftArm,rightArm)>C.phaseStart:joint>C.phaseStart;
        if(extended&&Math.abs(speed)<C.maxSpeed/10&&motion<C.stability) this.since??=now; else this.since=null;
        if(this.since!==null&&now-this.since>=C.readyMs) this.baseline={height,knee:joint,torso,leg,elbows:[drift(13),drift(14)],feet:[]};
        reason='Waiting for stable arms-down starting position'; return output();
      }
      if(this.state==='READY') {
        if(this.baseline.knee-joint>C.movementBend) {this.phaseSince??=now;if(now-this.phaseSince>=C.phaseMs){this.state='CURLING_UP';this.started=now;this.phaseSince=null;}}
        else this.phaseSince=null;
      }
      if(this.state==='CURLING_UP') {
        if(joint<C.phaseEnd) this.phaseSince??=now;else this.phaseSince=null;
        if(this.phaseSince!==null&&now-this.phaseSince>=C.phaseMs){this.state='TOP';this.phaseSince=null;}
      }
      if(this.state==='TOP' && speed>5){this.state='LOWERING';this.phaseSince=null;}
      if(this.state==='LOWERING') {
        if(joint>C.phaseStart) {
          this.phaseSince??=now;
          if(now-this.phaseSince>=C.phaseMs){this.reps++;this.reset();this.state='VALID_REP';reason='Completed controlled curl';return output();}
        } else this.phaseSince=null;
      }
      if(this.state==='VALID_REP') this.state='READY';
      if((this.state==='CURLING_UP'||this.state==='TOP'||this.state==='LOWERING') && (now-this.started>C.timeoutMs || Math.abs(speed)>C.maxSpeed)){this.reset();reason='Curl interrupted or too abrupt';return output();}
      evaluating=['CURLING_UP','TOP','LOWERING'].includes(this.state);
      if(this.view==='side') {
        const lean=Math.atan2(Math.abs(p[shoulder].x-p[h].x),p[h].y-p[shoulder].y)*180/Math.PI;
        add('torso',lean,C.maxLean,25,shoulder,h,{...p[shoulder],x:p[h].x},'rotation');
        add('upper-arm',Math.abs(drift(elbow)-this.baseline.elbows[s]),C.upperArmDrift,0.35,elbow,shoulder,{...p[elbow],x:p[shoulder].x});
        add('control',Math.abs(speed),C.maxSpeed*0.65,C.maxSpeed, wrist,elbow,p[wrist],'instability');
      } else {
        for(const e of [13,14]) add(`elbow-${e}`,drift(e),C.elbowDrift,0.35,e,e-2,{...p[e],x:p[e-2].x});
        const j=leftArm>rightArm?15:16, other=j===15?16:15;
        const size=dist(p[j],p[j-2])/Math.max(dist(p[other],p[other-2]),1e-5);
        add('arm-symmetry',Math.abs(leftArm-rightArm),C.asymmetry,40,j,j-2,{...p[j],x:p[j-2].x-(p[other].x-p[other-2].x)*size,y:p[j-2].y+(p[other].y-p[other-2].y)*size},'rotation');
      }
      add('stability',motion,C.stability,0.12,shoulder,h,p[shoulder],'instability');
    } else if(this.id==='plank') {
      const C=EXERCISES.plank;
      const span=dist(sh,foot)/torso;
      const extendedArms=this.view==='side'?angle(p[shoulder],p[elbow],p[wrist])>C.minElbowAngle:Math.min(leftArm,rightArm)>C.minElbowAngle;
      // The front view additionally needs 3D depth evidence to distinguish a plank from standing.
      const depth=worldOK?Math.abs((world![27].z!+world![28].z!-world![11].z!-world![12].z!)/2)/Math.max(Math.hypot(world![11].x-world![23].x,world![11].y-world![23].y,world![11].z!-world![23].z!),1e-5):0;
      const orientation=this.view==='side'?Math.atan2(Math.abs(foot.y-sh.y),Math.abs(foot.x-sh.x))*180/Math.PI<C.bodyHorizontalMax:depth>C.frontDepthMin;
      const supported=p[wrist].y>p[shoulder].y && (this.view==='side'||p[16].y>p[12].y);
      const plausible=orientation&&extendedArms&&supported&&joint>C.minKneeAngle&&(this.view==='front'||span>C.minBodySpan);
      angles.bodySpan=span;angles.depthEvidence=depth;
      if(!plausible) {this.state=this.state==='HOLDING'?'EXITED':'MOVING_INTO_POSITION';this.since=null;reason='Waiting for supported high plank';return output();}
      if(motion<=C.holdMotionMax) this.since??=now;else {this.since=null;this.state='MOVING_INTO_POSITION';}
      if(this.since!==null&&now-this.since>=C.holdMs)this.state='HOLDING';else this.state='MOVING_INTO_POSITION';
      evaluating=this.state==='HOLDING';
      if(this.view==='side') {
        const a=p[shoulder], b=p[ankle], line=dist(a,b);
        for(const j of [h,knee]) {
          const t=clamp(((p[j].x-a.x)*(b.x-a.x)+(p[j].y-a.y)*(b.y-a.y))/(line*line));
          const target={...p[j],x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)};
          add(j===h?'hip-line':'knee-line',dist(p[j],target)/line,j===h?C.hipOffset:C.kneeOffset,0.18,j,shoulder,target);
        }
        add('hand-stack',Math.abs(p[wrist].x-p[shoulder].x)/torso,C.handOffset,0.6,wrist,shoulder,{...p[wrist],x:p[shoulder].x});
      } else {
        for(const [l,r] of [[11,12],[23,24],[15,16],[27,28]]) {
          const j=p[l].y>p[r].y?l:r, other=j===l?r:l;
          add(`level-${l}`,Math.abs(p[l].y-p[r].y)/shoulderWidth,C.symmetry,0.35,j,other,{...p[j],y:p[other].y});
        }
        const hands=mid(p[15],p[16]);
        add('balance',Math.abs(hip.x-hands.x)/shoulderWidth,C.balance,0.5,h,shoulder,{...p[h],x:p[h].x+hands.x-hip.x});
      }
      add('stability',motion,C.stability,0.1,h,shoulder,p[h],'instability');
    } else {
      if(this.state==='FRAME_INVALID')this.state='CALIBRATING_STANDING';
      if(!this.baseline) {
        if(joint>F.uprightKnee&&range('height')<F.baselineRange)this.since??=now;else this.since=null;
        if(this.since!==null&&now-this.since>=F.baselineMs)this.baseline={height,knee:joint,torso,leg,elbows:[],feet:[{...p[27]},{...p[28]}]};
        reason='Waiting for upright front-view calibration';return output();
      }
      const drop=this.baseline.height-height,bend=this.baseline.knee-joint;
      angles.hipDrop=drop;angles.kneeBend=bend;
      if([27,28].some((i,s)=>dist(p[i],this.baseline!.feet[s])/leg>F.maxFootTravel)){this.reset();reason='Feet moved; recalibrate standing';return output();}
      if(this.state==='CALIBRATING_STANDING') {
        if(drop>F.minDrop&&bend>F.kneeBend){this.phaseSince??=now;if(now-this.phaseSince>=EXERCISES.squat.directionHoldMs){this.state='DESCENDING';this.started=now;this.since=null;}}
        else this.phaseSince=null;
      }
      if(this.state==='DESCENDING') {
        if(drop>F.minDrop&&bend>F.kneeBend&&range('height')<F.holdRange&&range('joint')<EXERCISES.squat.holdMaxKneeRange)this.since??=now;else this.since=null;
        if(this.since!==null&&now-this.since>=F.holdMs){this.state='HOLDING';this.holdHeight=height;}
      }
      if(this.state==='HOLDING'&&(drop<F.minDrop||speed>EXERCISES.squat.holdExitKneeSpeed))this.state='ASCENDING';
      if(this.state==='HOLDING' && this.holdHeight!==null && Math.abs(height-this.holdHeight)>EXERCISES.squat.holdExitHipRange){this.reset();reason='Moved out of squat hold';return output();}
      if(this.state==='ASCENDING'&&drop<F.returnDrop&&joint>F.uprightKnee){this.reps++;this.reset();this.state='VALID_REP';reason='Completed squat';return output();}
      if(this.state==='VALID_REP')this.state='CALIBRATING_STANDING';
      if(this.state==='DESCENDING'&&now-this.started>F.timeoutMs){this.reset();reason='Squat sequence not established';return output();}
      evaluating=this.state==='HOLDING';
      const width=Math.abs(p[27].x-p[28].x)/shoulderWidth;
      const targetWidth=Math.max(F.stanceMin,Math.min(F.stanceMax,width))*shoulderWidth;
      add('stance',Math.abs(width-targetWidth/shoulderWidth),0,0.7,ankle,knee,{...p[ankle],x:foot.x+Math.sign(p[ankle].x-foot.x)*targetWidth/2});
      for(const k of [25,26])add(`knee-track-${k}`,Math.abs(p[k].x-p[k+2].x)/shoulderWidth,F.kneeTrack,0.5,k,k+2,{...p[k],x:p[k+2].x});
      add('leg-symmetry',Math.abs(p[25].y-p[26].y)/leg,F.symmetry,0.25,knee,ankle,{...p[knee],y:(p[25].y+p[26].y)/2});
      add('balance',Math.abs(hip.x-foot.x)/shoulderWidth,F.balance,0.5,h,knee,{...p[h],x:p[h].x+foot.x-hip.x});
      add('stability',motion,F.stability,0.12,h,knee,p[h],'instability');
    }
    reason=evaluating?'Evaluating measured pose':`Waiting: ${this.state}`;
    return output();
  }
}
