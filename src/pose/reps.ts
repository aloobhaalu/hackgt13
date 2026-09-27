import type { RepRejection } from './types';

// The exercise state machine decides when a movement begins and finishes
// Form Alignment never decides whether that movement counts
export class MovementReps {
  count = 0;
  rejection: RepRejection | null = null;
  private active = false;
  begin() { this.active=true;this.rejection=null; }
  complete() {
    if(this.active){this.count++;this.active=false;this.rejection=null;}
  }
  reject(category:RepRejection['category'],reason:string) {
    if(this.active){this.rejection={category,reason};this.active=false;}
  }
}

// A fresh target gets a fresh evaluator while completed session reps stay visible
export class SessionReps {
  private total = 0;
  private previous = 0;
  newEvaluator() { this.previous=0; }
  observe(count:number|undefined) {
    if(count!==undefined && Number.isSafeInteger(count) && count>=0) {
      this.total+=Math.max(0,count-this.previous);
      this.previous=Math.max(this.previous,count);
    }
    return this.total;
  }
}
