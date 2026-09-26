import type { RecapDiagnostics } from '../recap/diagnostics';
import { rankedIssues } from '../recap/content';
import { createGeminiPayload } from '../recap/payload';
import type { SessionSummary } from '../recap/summary';

// Show this only in debug mode and keep credentials out
export default function RecapPayload({summary,diagnostics,ended=false}:{summary:SessionSummary;diagnostics?:RecapDiagnostics;ended?:boolean}) {
  const payload=createGeminiPayload(summary);
  return <section className="recap-payload" aria-label="Gemini recap payload">
    <h3>Gemini recap payload</h3>
    <p>Session data contains derived aggregate metrics only. This is the exact JSON request body, including fixed instructions and allowed phrases. Sent only after End when Gemini is configured; demos stay local.</p>
    <dl><dt>Gemini called</dt><dd>{diagnostics?(diagnostics.geminiCalled===null?'Unknown (server outcome unavailable)':String(diagnostics.geminiCalled)):ended?'Pending server outcome':'No (live session)'}</dd><dt>Displayed recap source</dt><dd>{diagnostics?.source??(ended?'Preparing':'Not requested')}</dd><dt>Outcome</dt><dd>{diagnostics?.reason??'Not available yet'}</dd></dl>
    <pre tabIndex={0}>{payload?JSON.stringify(payload,null,2):'No valid aggregate payload available.'}</pre>
    <h4>Ranked measured issues</h4><pre>{JSON.stringify(rankedIssues(summary),null,2)}</pre>
  </section>;
}
