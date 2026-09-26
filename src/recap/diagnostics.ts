export const RECAP_REASONS=['gemini','missing_key','demo','invalid_summary','invalid_model','timeout','network_error','invalid_output','http_error','rate_limited','model_unavailable','unknown_server','pending'] as const;
export type RecapReason=typeof RECAP_REASONS[number];
export type RecapDiagnostics={geminiCalled:boolean|null;source:'gemini'|'local';reason:RecapReason};
