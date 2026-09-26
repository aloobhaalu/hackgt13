import { EXERCISES, FRONT_SQUAT as F, TRACKING, VIEW, FEEDBACK, type CameraView, type ExerciseId } from '../config';
import { ScoreWindow } from './scoreWindow';
import { curlFacing } from './curlVisual';
import { frontFoot } from './frontFoot';
import type { Assessment, Correction, Point, Pose, ScoreComponent } from './types';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) });
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function angle(a: Point, b: Point, c: Point) {
  const u = [a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0)], v = [c.x-b.x,c.y-b.y,(c.z??0)-(b.z??0)];
  const d = Math.hypot(...u)*Math.hypot(...v);
  return d > 1e-8 ? Math.acos(Math.max(-1,Math.min(1,u.reduce((s,x,i)=>s+x*v[i],0)/d)))*180/Math.PI : NaN;
}

type CurlStart = {
  arms: { angle:number; wrist:Point; elbow:Point; elbowFromHip:Point; length:number }[];
  torso:number; tilt:number; hip:Point; midpoint:boolean; facing:number|null;
};

export class ViewCoach {
  private state = 'FRAME_INVALID';
  private since: number | null = null;
  private viewSince: number | null = null;
  private phaseSince: number | null = null;
  private started = 0;
  private at: number | null = null;
  private source: 'world' | 'image' | null = null;
  private holdHeight: number | null = null;
  private baseline: { height: number; knee: number; torso: number; leg: number; elbows: number[]; feet: Point[]; handHeight?: number } | null = null;
  private history: { at: number; height: number; joint: number; center: Point }[] = [];
  private displayScore = new ScoreWindow();
  private curlStart: CurlStart | null = null;
  private curlCalibration: CurlStart[] = [];
  private curlCycleValid = false;
  private curlFailure:string|null=null;
  private curlBlock='No arms-down calibration';
  private curlReturnSince:number|null=null;
  private curlPeakBend = 0;
  private curlPartial = {count:0,severityTotal:0,maxSeverity:0};
  private recordPartial(severity:number) {
    if(!this.curlCycleValid)return;
    const measured=clamp(severity);
    this.curlPartial.count++;this.curlPartial.severityTotal+=measured;this.curlPartial.maxSeverity=Math.max(this.curlPartial.maxSeverity,measured);
  }
  private curlLowestAngle = 0;
  private curlProgressAt = 0;
  private curlReverseSince: number | null = null;
  private curlPreviousBody: {hip:Point;shoulder:Point} | null = null;
  private holdStarted: number | null = null;
  private bottomReached = false;
  private squatBottomSince:number|null=null;
  private squatAscentSince:number|null=null;
  private squatReturnSince:number|null=null;
  private squatFailure:string|null=null;
  private squatBlock='No standing calibration';
  private activeIssues = new Set<string>();
  private errors = new Map<string, number>();
  constructor(private id: ExerciseId, private view: CameraView) {}
  pauseEvidence() {
    // Keep the phase we saw, but leave tracking gaps out of transition timing
    this.phaseSince=null;this.since=null;this.curlReturnSince=null;this.curlReverseSince=null;
    this.squatAscentSince=null;this.squatReturnSince=null;this.squatBottomSince=null;
    this.curlCalibration=[];this.curlPreviousBody=null;this.history=[];
    this.displayScore.reset();this.errors.clear();this.activeIssues.clear();
  }
  reset() { if(this.id==='curl'&&['CURLING_UP','TOP','LOWERING'].includes(this.state))this.curlFailure='Tracking/view confidence lost';this.curlReturnSince=null; if(this.id==='squat' && ['DESCENDING','HOLDING','ASCENDING'].includes(this.state))this.squatFailure='Tracking/view confidence lost';this.squatBottomSince=null;this.squatAscentSince=null;this.squatReturnSince=null; this.curlStart=null;this.curlCalibration=[];this.curlCycleValid=false;this.curlPreviousBody=null;this.curlReverseSince=null; this.holdStarted=null; this.bottomReached=false; this.state='FRAME_INVALID'; this.since=null; this.phaseSince=null; this.viewSince=null; this.at=null; this.baseline=null; this.history=[]; this.errors.clear(); this.activeIssues.clear();this.displayScore.reset(); this.source=null; this.holdHeight=null; }

  curlCycle(){return {state:this.state,calibrated:!!this.curlStart,validCycle:this.curlCycleValid,topConfirmed:this.curlCycleValid&&['TOP','LOWERING'].includes(this.state),blockReason:this.state==='FRAME_INVALID'?'Tracking/view confidence lost':this.curlBlock,lastFailure:this.curlFailure,returnConfirmationMs:this.curlReturnSince!==null&&this.at!==null?this.at-this.curlReturnSince:0};}

  squatCycle(){return {state:this.baseline&&this.state==='CALIBRATING_STANDING'?'CALIBRATED_STANDING':this.state,blockReason:this.state==='FRAME_INVALID'?'Tracking/view confidence lost':this.squatBlock,lastFailure:this.squatFailure,calibrated:!!this.baseline,bottomConfirmed:this.bottomReached,ascentConfirmationMs:this.squatAscentSince!==null&&this.at!==null?this.at-this.squatAscentSince:0};}

  update(pose: Pose, now: number, aspect: number, side: number, base: Assessment, world?: Pose): Assessment {
    if (this.at !== null && (now-this.at > EXERCISES.squat.maxFrameGapMs || now<=this.at)) this.reset();
    const dt = this.at === null ? 0 : (now-this.at)/1000; this.at=now;
    const p=pose.map(v=>({...v,x:v.x*aspect,z:0}));
    const s=side, shoulder=11+s, elbow=13+s, wrist=15+s, h=23+s, knee=25+s, ankle=27+s;
    const sh=this.view==='side'?p[shoulder]:mid(p[11],p[12]), hip=this.view==='side'?p[h]:mid(p[23],p[24]), foot=this.view==='side'?p[ankle]:mid(p[27],p[28]);
    const torso=dist(p[shoulder],p[h]);
    const shoulderWidth=dist(p[11],p[12]);
    const spread=Math.abs(p[11].x-p[12].x)/Math.max(torso,1e-6);
    const orientationVisible=[11,12].every(i=>p[i].visibility>=TRACKING.visibility);
    const viewValid=orientationVisible && (this.view==='side' ? spread<=VIEW.sideMaxSpread : spread>=VIEW.frontMinSpread);
    const components: ScoreComponent[]=[], candidates: Correction[]=[];
    const angles: Record<string,number>={ shoulderSpread:spread };
    const add=(id:string,value:number,limit:number,range:number,joint:number,anchor:number,target:Point,kind:Correction['kind']='translation',requiredReturn=false)=>{
      if(!Number.isFinite(value)||![target.x,target.y].every(Number.isFinite))return;
      const error=Math.max(0,(value-limit)/range);
      components.push({id,value,limit,error,score:100*(1-clamp(error))});
      if((requiredReturn && error>0) || error>(this.activeIssues.has(id)?FEEDBACK.issueRelease:FEEDBACK.issueEnter)) candidates.push({id,label:'',joint,anchor,target:{...target,x:target.x/aspect},severity:error,kind});
    };
    let reason='Waiting for exercise position', evaluating=false, coaching=false, ready=false;
    const output=():Assessment=>{
      coaching=coaching && this.state!=='FRAME_INVALID';
      for(const id of this.errors.keys()) if(!coaching || !candidates.some(c=>c.id===id)) {this.errors.delete(id);this.activeIssues.delete(id);}
      for(const c of coaching?candidates:[]) if(!this.errors.has(c.id)) this.errors.set(c.id,now);
      const corrections=coaching ? candidates.filter(c=>now-this.errors.get(c.id)!>=FEEDBACK.correctionConfirmMs):[];
      corrections.forEach(c=>this.activeIssues.add(c.id));
      let rawScore=evaluating && components.length ? components.reduce((v,c)=>v+c.score!,0)/components.length:null;
      if(this.id==='curl' && rawScore!==null) {
        // Group related checks so extra good measurements cannot hide an issue
        const groups=new Map<keyof typeof EXERCISES.curl.scoreWeights,number>();
        for(const c of components) {
          const group=c.id==='torso'||c.id==='hip-shift'?'torso':c.id.startsWith('bottom-range')?'range':c.id==='arm-symmetry'?'symmetry':c.id==='stability'||c.id==='trunk-swing'?'stability':c.id==='control'?'control':'arm';
          groups.set(group,Math.max(groups.get(group)??0,clamp(c.error)));
        }
        const weights=EXERCISES.curl.scoreWeights;
        const total=[...groups.keys()].reduce((sum,key)=>sum+weights[key],0);
        rawScore=100*(1-[...groups].reduce((sum,[key,error])=>sum+error*weights[key],0)/total);
      }
      const score=this.displayScore.update(rawScore,now,FEEDBACK.scoreIntervalMs[this.id]);
      if(this.id==='plank' && this.state==='HOLDING' && evaluating) this.holdStarted??=now; else this.holdStarted=null;
      return {...base,ready:true,score,scoreStatus:score!==null?'live':ready && this.state!=='FRAME_INVALID'?'ready':'uncertain',holdMs:this.holdStarted===null?0:now-this.holdStarted,reason,corrections,correction:corrections[0]??null,
        phase:this.state==='HOLDING'||this.state==='TOP'?'Hold':this.state==='DESCENDING'?'Lower':this.state==='ASCENDING'?'Rise':this.state==='CURLING_UP'?'Curl':this.state==='LOWERING'?'Release':'Ready',
        debug:{...base.debug,curlCycle:this.id==='curl'?this.curlCycle():undefined,squatCycle:this.id==='squat'?{state:this.baseline&&this.state==='CALIBRATING_STANDING'?'CALIBRATED_STANDING':this.state,blockReason:this.squatBlock,lastFailure:this.squatFailure,calibrated:!!this.baseline,bottomConfirmed:this.bottomReached,ascentConfirmationMs:this.squatAscentSince===null?0:now-this.squatAscentSince}:undefined,exercise:this.id,view:this.view,state:this.state,viewValid,coachingEnabled:coaching,scoringEnabled:evaluating,scoreUpdatedAt:this.displayScore.updatedAt,curlPartial:this.id==='curl'?{...this.curlPartial}:undefined,angles,components:coaching?components:[],reason,validMovement:evaluating,rawScore,stableFrames:this.history.length}};
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
      coaching=true; ready=true;
      if(this.view==='side') {
        const torsoMidpoints=[11,12,23,24].every(i=>p[i].visibility>=TRACKING.visibility);
        const shMid=torsoMidpoints?mid(p[11],p[12]):p[shoulder],hipMid=torsoMidpoints?mid(p[23],p[24]):p[h];
        const lean=Math.atan2(shMid.x-hipMid.x,hipMid.y-shMid.y)*180/Math.PI;
        const baselineTilt=this.curlStart?.tilt??0,r=baselineTilt*Math.PI/180;
        add('torso',Math.abs(lean-baselineTilt),C.maxLean,C.leanPenaltyRange,shoulder,h,{...p[shoulder],x:p[h].x+Math.sin(r)*torso,y:p[h].y-Math.cos(r)*torso},'rotation');
        add('upper-arm',drift(elbow),C.upperArmDrift,0.35,elbow,shoulder,{...p[elbow],x:p[shoulder].x});
        // Only infer front/back direction when face landmarks provide actual evidence
        const ears=[7,8].filter(i=>p[i].visibility>=TRACKING.visibility);
        const faceDirection=ears.length && p[0].visibility>=TRACKING.visibility ? p[0].x-ears.reduce((sum,i)=>sum+p[i].x,0)/ears.length:0;
        if(Math.abs(faceDirection)>torso*0.02) {
          const facing=curlFacing(p);
          add('forearm-path',-(p[wrist].x-p[elbow].x)*facing/torso,C.backwardForearm,0.4,wrist,elbow,{...p[wrist],x:p[elbow].x+facing*torso*0.05});
        }
        add('control',Math.abs(speed),C.maxSpeed*0.65,C.maxSpeed, wrist,elbow,p[wrist],'instability');
      } else {
        for(const e of [13,14]) {const baseline=this.curlStart?.arms[e-13].elbow.x??0,offset=baseline*torso/(this.curlStart?.torso??torso);add(`elbow-${e}`,Math.abs(p[e].x-p[e-2].x-offset)/torso,C.elbowDrift,0.35,e,e-2,{...p[e],x:p[e-2].x+offset});}
        for(const w of [15,16]) {
          const outward=Math.sign(p[w-4].x-sh.x);
          add(`hand-path-${w}`,(p[w].x-p[w-2].x)*outward/torso,C.handSideways,0.4,w,w-2,{...p[w],x:p[w-2].x});
        }
        const j=leftArm>rightArm?15:16, other=j===15?16:15;
        const size=dist(p[j],p[j-2])/Math.max(dist(p[other],p[other-2]),1e-5);
        add('arm-symmetry',Math.abs(leftArm-rightArm),C.asymmetry,40,j,j-2,{...p[j],x:p[j-2].x-(p[other].x-p[other-2].x)*size,y:p[j-2].y+(p[other].y-p[other-2].y)*size},'rotation');
      }
      add('stability',motion,C.stability,0.12,shoulder,h,p[shoulder],'instability');
      const armSides=this.view==='front'?[0,1]:[s];
      const midpoint=[11,12,23,24].every(i=>p[i].visibility>=TRACKING.visibility);
      const bodyShoulder=midpoint?mid(p[11],p[12]):p[shoulder],bodyHip=midpoint?mid(p[23],p[24]):p[h];
      const tilt=Math.atan2(bodyShoulder.x-bodyHip.x,bodyHip.y-bodyShoulder.y)*180/Math.PI;
      const ears=[7,8].filter(i=>p[i].visibility>=TRACKING.visibility);
      const faceDx=ears.length && p[0].visibility>=TRACKING.visibility?p[0].x-ears.reduce((sum,i)=>sum+p[i].x,0)/ears.length:0;
      const facing=Math.abs(faceDx)>torso*C.facingEvidence?Math.sign(faceDx):null;
      const arms=armSides.map(side=>{
        const e=13+side,w=15+side;
        return {angle:side===0?leftArm:rightArm,wrist:{...p[w],x:p[w].x-bodyHip.x,y:p[w].y-bodyHip.y},elbow:{...p[e],x:p[e].x-p[11+side].x,y:p[e].y-p[11+side].y},
          elbowFromHip:{...p[e],x:p[e].x-bodyHip.x,y:p[e].y-bodyHip.y},length:dist(p[11+side],p[e])+dist(p[e],p[w])};
      });
      const plausibleArms=armSides.every(side=>{
        const upper=dist(p[11+side],p[13+side]);
        const abduction=Math.atan2(Math.abs(p[13+side].x-p[11+side].x),p[13+side].y-p[11+side].y)*180/Math.PI;
        return (p[13+side].y-p[11+side].y)/Math.max(upper,1e-5)>C.minUpperArmVertical && abduction<C.maxArmAbduction;
      });
      if(!plausibleArms) {this.curlFailure='Arm motion does not follow a standing curl path';this.curlBlock=this.curlFailure;this.curlCycleValid=false;this.state='READY';this.curlStart=null;this.curlCalibration=[];this.since=null;this.phaseSince=null;reason='Arm motion does not follow a standing curl path';return output();}
      if(!this.curlStart) {
        this.curlBlock='No stable arms-down calibration';
        const extended=arms.every(a=>a.angle>C.phaseStart);
        const aligned=armSides.every(side=>drift(13+side)<(this.view==='front'?C.elbowDrift:C.upperArmDrift));
        const origin=this.curlCalibration[0];
        const settledBody=!origin || (dist(bodyHip,origin.hip)/torso<C.stability && Math.abs(tilt-origin.tilt)<C.calibrationAngleRange);
        const stable=extended && aligned && settledBody && Math.abs(speed)<C.calibrationSpeed && range('joint')<C.calibrationAngleRange && motion<C.stability && (this.view==='front'||Math.abs(tilt)<=C.calibrationLeanMax);
        if(stable){this.since??=now;this.curlCalibration.push({arms,torso,tilt,hip:{...bodyHip},midpoint,facing});}
        else {this.since=null;this.curlCalibration=[];}
        if(this.since!==null&&now-this.since>=C.readyMs) {
          const frames=this.curlCalibration,mean=(fn:(f:CurlStart)=>number)=>frames.reduce((sum,f)=>sum+fn(f),0)/frames.length;
          const meanPoint=(fn:(f:CurlStart)=>Point):Point=>({x:mean(f=>fn(f).x),y:mean(f=>fn(f).y),visibility:1});
          this.curlStart={torso:mean(f=>f.torso),tilt:mean(f=>f.tilt),hip:meanPoint(f=>f.hip),midpoint:frames.every(f=>f.midpoint),
            facing:frames.every(f=>f.facing===facing)?facing:null,
            arms:arms.map((_,i)=>({angle:mean(f=>f.arms[i].angle),length:mean(f=>f.arms[i].length),wrist:meanPoint(f=>f.arms[i].wrist),elbow:meanPoint(f=>f.arms[i].elbow),elbowFromHip:meanPoint(f=>f.arms[i].elbowFromHip)}))};
          this.curlCalibration=[];this.since=null;
        }
        reason='Calibrating natural upright arms-down position';return output();
      }
      const start=this.curlStart,scale=torso/start.torso;
      const down=arms.map((arm,i)=>{
        const b=start.arms[i];
        const bend=Math.max(0,b.angle-arm.angle);
        const wristDistance=Math.hypot(arm.wrist.x-b.wrist.x*scale,arm.wrist.y-b.wrist.y*scale)/Math.max(b.length*scale,1e-5);
        angles[`returnAngle-${armSides[i]}`]=bend;angles[`returnWrist-${armSides[i]}`]=wristDistance;
        return {bend,wristDistance,accepted:bend<=C.downAngleTolerance && wristDistance<=C.downWristTolerance};
      });
      angles.baselineTorso=start.tilt;angles.baselineElbow=start.arms.reduce((sum,a)=>sum+a.angle,0)/start.arms.length;
      const atDown=down.every(a=>a.accepted);
      this.curlBlock=this.state==='READY'?'Waiting for upward elbow flexion':this.state==='CURLING_UP'?'Top not reached':this.state==='TOP'?'Controlled lowering not detected':atDown?'Confirming arms-down return':'Return to calibrated arms-down position';
      angles.bottomAccepted=atDown?1:0;
      if(this.state==='READY') {
        const bending=arms.every((a,i)=>start.arms[i].angle-a.angle>C.movementBend);
        const rising=arms.every((a,i)=>(start.arms[i].wrist.y*scale-a.wrist.y)/(start.arms[i].length*scale)>C.movementRise);
        if(bending&&rising){this.phaseSince??=now;if(now-this.phaseSince>=C.phaseMs){this.state='CURLING_UP';this.started=now;this.phaseSince=null;this.curlCycleValid=true;this.curlFailure=null;this.curlReturnSince=null;this.curlPeakBend=0;}}
        else this.phaseSince=null;
      }
      if(this.state==='CURLING_UP') {
        this.curlPeakBend=Math.max(this.curlPeakBend,...down.map(a=>a.bend));
        if(arms.every((a,i)=>a.angle<=C.phaseEnd && down[i].bend>=C.topMinBend))this.phaseSince??=now;else this.phaseSince=null;
        if(this.phaseSince!==null&&now-this.phaseSince>=C.topConfirmMs){this.state='TOP';this.phaseSince=null;}
        if(atDown){this.curlFailure='Top not reached';this.recordPartial(1-this.curlPeakBend/Math.max(1,angles.baselineElbow-C.phaseEnd));this.state='LOWERING';this.curlCycleValid=false;this.phaseSince=null;this.curlLowestAngle=joint;this.curlProgressAt=now;}
      }
      if(this.state==='TOP') {
        if(speed>C.directionSpeed)this.phaseSince??=now;else this.phaseSince=null;
        if(this.phaseSince!==null&&now-this.phaseSince>=C.phaseMs){this.state='LOWERING';this.phaseSince=null;this.curlLowestAngle=joint;this.curlProgressAt=now;}
      }
      if(this.state==='LOWERING') {
        if(speed>C.directionSpeed && joint>this.curlLowestAngle)this.curlProgressAt=now;
        this.curlLowestAngle=Math.max(this.curlLowestAngle,joint);
        const reversed=this.curlLowestAngle-joint>C.movementBend;
        if(reversed)this.curlReverseSince??=now;else this.curlReverseSince=null;
        if(this.curlReverseSince!==null&&now-this.curlReverseSince>=C.phaseMs){this.curlFailure='Incomplete lowering before the next curl';this.recordPartial(Math.max(...down.map(a=>Math.max(a.bend/C.bottomPenaltyAngle,a.wristDistance))));this.curlCycleValid=false;}
        const incomplete=now-this.curlProgressAt>=C.loweringStallMs || !this.curlCycleValid;
        angles.loweringStallMs=now-this.curlProgressAt;angles.bottomAccepted=atDown?1:0;
        for(const [i,a] of down.entries()) if(!a.accepted && incomplete) {
          const side=armSides[i],b=start.arms[i],e=13+side,w=15+side;
          const error=Math.max((a.bend-C.downAngleTolerance)/C.bottomPenaltyAngle,(a.wristDistance-C.downWristTolerance));
          add(`bottom-range-${side}`,Math.max(0,error),0,1,w,e,{...p[w],x:bodyHip.x+b.wrist.x*scale,y:bodyHip.y+b.wrist.y*scale},'translation',true);
          const cue=candidates.find(c=>c.id===`bottom-range-${side}`);
          if(cue)cue.targetAnchor={...p[e],x:(bodyHip.x+b.elbowFromHip.x*scale)/aspect,y:bodyHip.y+b.elbowFromHip.y*scale};
        }
        // Check both elbow angle and wrist position when the arms return
        // There is no need to repeat the initial standing-still calibration
        if(atDown)this.curlReturnSince??=now;else this.curlReturnSince=null;
        if(this.curlReturnSince!==null&&now-this.curlReturnSince>=C.downStableMs) {
          if(this.curlCycleValid)this.curlFailure=null;
          this.state='READY';this.phaseSince=null;this.curlReturnSince=null;this.curlReverseSince=null;this.curlCycleValid=false;this.curlBlock='Waiting for upward elbow flexion';
          reason='Returned to calibrated bottom; ready for next curl';return output();
        }
      }
      if(['CURLING_UP','TOP','LOWERING'].includes(this.state) && (now-this.started>C.timeoutMs || Math.abs(speed)>C.maxSpeed)) {
        this.curlFailure=now-this.started>C.timeoutMs?'Curl sequence timed out':'Movement too abrupt to recognize';this.recordPartial(Math.max(...down.map(a=>Math.max(a.bend/C.bottomPenaltyAngle,a.wristDistance))));this.curlCycleValid=false;this.state='LOWERING';this.curlProgressAt=0;
      }
      if(this.view==='side' && ['CURLING_UP','TOP','LOWERING'].includes(this.state) && midpoint && start.midpoint) {
        const direction=start.facing;
        const lean=direction===null?Math.abs(tilt-start.tilt):-(tilt-start.tilt)*direction;
        angles.backwardLean=lean;
        if(direction!==null)add('hip-shift',(bodyHip.x-start.hip.x)*direction/start.torso,C.hipShift,C.hipShiftPenaltyRange,h,h,{...p[h],x:p[h].x+start.hip.x-bodyHip.x});
        const old=this.curlPreviousBody;
        if(old && dt>0) {
          const trunkSpeed=Math.max(dist(bodyShoulder,old.shoulder),dist(bodyHip,old.hip))/start.torso/dt;
          angles.trunkSpeed=trunkSpeed;
          add('trunk-swing',trunkSpeed,C.trunkSpeed,C.trunkSpeedPenaltyRange,shoulder,h,p[shoulder],'instability');
        }
      }
      this.curlPreviousBody={hip:{...bodyHip},shoulder:{...bodyShoulder}};
      evaluating=['CURLING_UP','TOP','LOWERING'].includes(this.state);
    } else if(this.id==='plank') {
      const C=EXERCISES.plank;
      const span=dist(sh,foot)/torso;
      const extendedArms=this.view==='side'?angle(p[shoulder],p[elbow],p[wrist])>C.minElbowAngle:Math.min(leftArm,rightArm)>C.minElbowAngle;
      // Use depth in front view so standing cannot look like a plank
      const depth=worldOK?Math.abs((world![27].z!+world![28].z!-world![11].z!-world![12].z!)/2)/Math.max(Math.hypot(world![11].x-world![23].x,world![11].y-world![23].y,world![11].z!-world![23].z!),1e-5):0;
      const orientation=this.view==='side'?Math.atan2(Math.abs(foot.y-sh.y),Math.abs(foot.x-sh.x))*180/Math.PI<C.bodyHorizontalMax:depth>C.frontDepthMin;
      const supported=p[wrist].y>p[shoulder].y && (this.view==='side'||p[16].y>p[12].y);
      const plausible=orientation&&extendedArms&&supported&&joint>C.minKneeAngle&&(this.view==='front'||span>C.minBodySpan);
      angles.bodySpan=span;angles.depthEvidence=depth;
      ready=orientationVisible && viewValid && motion<=C.holdMotionMax && p[shoulder].y<p[h].y;
      if(!plausible) {this.state=this.state==='HOLDING'?'EXITED':'MOVING_INTO_POSITION';this.since=null;reason='Waiting for supported high plank';return output();}
      coaching=true;
      if(motion<=C.holdMotionMax) this.since??=now;else {this.since=null;this.state='MOVING_INTO_POSITION';}
      if(this.since!==null&&now-this.since>=C.holdMs)this.state='HOLDING';else this.state='MOVING_INTO_POSITION';
      evaluating=true;
      if(this.view==='side') {
        const a=p[shoulder], b=p[ankle], line=dist(a,b);
        for(const j of [h,knee]) {
          const t=clamp(((p[j].x-a.x)*(b.x-a.x)+(p[j].y-a.y)*(b.y-a.y))/(line*line));
          const target={...p[j],x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)};
          if(j===h)angles.hipLineOffset=(p[j].y-target.y)/line;
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
      coaching=p[shoulder].y<p[h].y && (this.baseline!==null || joint>F.uprightKnee);
      ready=coaching && joint>F.uprightKnee;
      const width=Math.abs(p[27].x-p[28].x),hipWidth=Math.abs(p[23].x-p[24].x);
      // Center both foot targets around the feet, exactly one measured shoulder width apart
      const targetWidth=shoulderWidth*F.stanceShoulderTarget;
      const footReliable=[11,12,27,28].every(i=>p[i].visibility>=F.stanceVisibility);
      const wasStanceActive=[...this.activeIssues].some(id=>id.startsWith('stance-'));
      const stanceAccepted=footReliable && Math.abs(width-targetWidth)/shoulderWidth<=(wasStanceActive?F.stanceRelease:F.stanceTolerance);
      angles.stanceDirection=width<targetWidth?-1:width>targetWidth?1:0;angles.stanceReliable=footReliable?1:0;
      angles.stanceShoulderRatio=width/shoulderWidth;angles.stanceHipRatio=width/Math.max(hipWidth,1e-5);
      angles.stanceTarget=F.stanceShoulderTarget;angles.stanceMin=F.stanceShoulderTarget-F.stanceTolerance;angles.stanceMax=F.stanceShoulderTarget+F.stanceTolerance;
      if(footReliable)for(const an of [27,28])add(`stance-${width<targetWidth?'narrow':'wide'}-${an}`,Math.abs(width-targetWidth)/shoulderWidth,wasStanceActive?F.stanceRelease:F.stanceTolerance,0.5,an,an,{...p[an],x:foot.x+(Math.sign(p[an].x-foot.x)||(an===27?-1:1))*targetWidth/2},'translation',true);
      const feet=[0,1].map(s=>frontFoot(p,s,this.baseline?.leg??leg,aspect));
      for(const direction of feet) if(direction) {
        angles[`toeAngle-${direction.toe}`]=direction.angle;
        const error=Math.max(0,F.toeOutMin-direction.angle,direction.angle-F.toeOutMax);
        add(`toe-direction-${direction.toe}`,error,0,F.toePenaltyRange,direction.toe,direction.heel,direction.target,'rotation');
      }
      add('leg-symmetry',Math.abs(p[25].y-p[26].y)/leg,F.symmetry,0.25,knee,ankle,{...p[knee],y:(p[25].y+p[26].y)/2});
      add('balance',Math.abs(hip.x-foot.x)/shoulderWidth,F.balance,0.5,h,knee,{...p[h],x:p[h].x+foot.x-hip.x});
      add('stability',motion,F.stability,0.12,h,knee,p[h],'instability');
      const footDifference=Math.abs(p[27].y-p[28].y)/leg;
      const highFoot=p[27].y<p[28].y?27:28;
      add('foot-symmetry',footDifference,F.symmetry,0.25,highFoot,highFoot-2,{...p[highFoot],y:Math.max(p[27].y,p[28].y)});
      if(!this.baseline) {
        if(joint>F.uprightKnee&&range('height')<F.baselineRange)this.since??=now;else this.since=null;
        if(this.since!==null&&now-this.since>=F.baselineMs)this.baseline={height,knee:joint,torso,leg,elbows:[],feet:[{...p[27]},{...p[28]}]};
        this.squatBlock=this.baseline?'Descent too small':'No standing calibration';reason='Waiting for upright front-view calibration';return output();
      }
      const drop=this.baseline.height-height,bend=this.baseline.knee-joint;
      angles.hipDrop=drop;angles.kneeBend=bend;
      if([27,28].some((i,s)=>dist(p[i],this.baseline!.feet[s])/leg>F.maxFootTravel)){this.reset();reason='Feet moved; recalibrate standing';return output();}
      if(this.state==='CALIBRATING_STANDING') {
        if(drop>F.minDrop&&bend>F.kneeBend){this.phaseSince??=now;if(now-this.phaseSince>=EXERCISES.squat.directionHoldMs){this.state='DESCENDING';this.squatFailure=null;this.bottomReached=false;this.squatBottomSince=null;this.squatAscentSince=null;this.started=now;this.since=null;}}
        else this.phaseSince=null;
      }
      if(this.state==='DESCENDING') {
        if(drop>=F.bottomDrop && bend>=F.bottomKneeBend)this.squatBottomSince??=now;else if(!this.bottomReached)this.squatBottomSince=null;
        if(this.squatBottomSince!==null&&now-this.squatBottomSince>=F.bottomConfirmMs)this.bottomReached=true;
        if(drop>F.minDrop&&bend>F.kneeBend&&range('height')<F.holdRange&&range('joint')<EXERCISES.squat.holdMaxKneeRange)this.since??=now;else this.since=null;
        if(this.since!==null&&now-this.since>=F.holdMs){this.state='HOLDING';this.holdHeight=height;}
      }
      const rising=speed>EXERCISES.squat.directionKneeSpeed && !!previous && height>previous.height;
      if(['DESCENDING','HOLDING'].includes(this.state)&&rising)this.squatAscentSince??=now;else this.squatAscentSince=null;
      if(['DESCENDING','HOLDING'].includes(this.state) && this.squatAscentSince!==null && now-this.squatAscentSince>=F.ascentConfirmMs) {
        this.state='ASCENDING';this.started=now;
      }
      if(this.state==='HOLDING' && !rising && this.holdHeight!==null && Math.abs(height-this.holdHeight)>EXERCISES.squat.holdExitHipRange){this.reset();reason='Moved out of squat hold';return output();}
      if(this.state==='ASCENDING') {
        if(drop<=F.returnDrop && bend<=F.returnKneeTolerance)this.squatReturnSince??=now;else this.squatReturnSince=null;
        if(this.squatReturnSince!==null&&now-this.squatReturnSince>=F.returnConfirmMs){
          if(!this.bottomReached)this.squatFailure='No confirmed bottom/reversal';
          else this.squatFailure=null;
          this.displayScore.reset();this.state='CALIBRATING_STANDING';this.since=null;this.phaseSince=null;this.squatReturnSince=null;this.squatAscentSince=null;this.squatBottomSince=null;this.bottomReached=false;
          ready=true;this.squatBlock=this.squatFailure??'Descent too small';reason=this.squatFailure??'Completed squat; calibrated for next descent';return output();
        }
      }
      this.squatBlock=this.state==='ASCENDING'?'Did not return to standing':this.state==='DESCENDING'?(this.bottomReached?'Ascent not detected':'No confirmed bottom/reversal'):this.state==='HOLDING'?'Ascent not detected':'Descent too small';
      if(['DESCENDING','ASCENDING'].includes(this.state)&&now-this.started>F.timeoutMs){const failed=this.squatBlock;this.reset();this.squatFailure=failed;reason=failed;return output();}
      // Get foot placement right first
      // Save knee tracking arrows for the squat movement
      if(stanceAccepted && ['DESCENDING','HOLDING','ASCENDING'].includes(this.state)) {
        for(const s of [0,1]) {
          const k=25+s,an=27+s,direction=feet[s];
          // Follow the foot's projected direction conservatively, unclear toes use the ankle
          const offset=direction?Math.max(-F.kneeDirectionOffsetMax*shoulderWidth,Math.min(F.kneeDirectionOffsetMax*shoulderWidth,direction.dx)):0;
          const target={...p[k],x:p[an].x+offset};
          add(`knee-track-${k}`,Math.abs(p[k].x-target.x)/shoulderWidth,F.kneeTrack,0.5,k,an,target);
        }
      }
      evaluating=['DESCENDING','HOLDING','ASCENDING'].includes(this.state);

    }
    reason=evaluating?'Evaluating measured pose':`Waiting: ${this.state}`;
    return output();
  }
}
