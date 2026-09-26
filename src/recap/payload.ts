import { recapOptions } from './content';
import { parseSummary } from './summary';

/** Shared by the server and developer preview: the complete JSON request body, never headers. */
export function createGeminiPayload(value:unknown) {
  const summary=parseSummary(value);
  if(!summary)return null;
  const choices=recapOptions(summary);
  const schema={type:'object',additionalProperties:false,required:['headline','tips'],properties:{
    headline:{type:'string',enum:choices.headlines,description:'Maximum 8 words.'},
    tips:{type:'array',maxItems:choices.tips.length?2:0,items:{type:'string',...(choices.tips.length?{enum:choices.tips}:{}),description:'Maximum 12 words.'}},
  }};
  return {
    systemInstruction:{parts:[{text:'Return only the requested JSON object. Write a brief, practical, non-medical recap for the supplied exercise using only the supplied aggregate metrics. Use the allowed headline for the leading measured issue, ranked by episode count times mean severity. Select at most two allowed tips from the leading measured issue categories only. Never default to torso alignment unless torso lean leads that ranking. When enoughValidData is false, do not praise performance or invent rep quality; only address measured setup issues, if any. Do not invent measurements, injuries, diagnoses, anatomy claims, dumbbell detection, or advice outside the allowed choices.'}]},
    contents:[{role:'user',parts:[{text:JSON.stringify({summary,allowed:choices})}]}],
    generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:256},
  };
}
