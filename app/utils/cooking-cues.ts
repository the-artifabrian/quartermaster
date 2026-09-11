/**
 * Shared bound for the instruction scanners behind cooking cues
 * (`detectTimes`, `detectTemperatures`).
 *
 * Both scanners are superlinear in the length of a single instruction: their
 * number patterns have to backtrack across a run of digits before they can
 * fail, which is quadratic even after the ambiguity fix in time-detection.ts.
 * A recipe may legitimately carry 200 instructions (recipe-validation.ts) of up
 * to 5000 characters each (the import and LLM-extraction caps), so an uncapped
 * scan is ~1MB of backtracking on every single render of that recipe — the
 * shape of failure that wedged production on 2026-09-11.
 *
 * Cooking cues are a display nicety, not data: the safe degradation is to skip
 * detection and render the step as plain text. The longest instruction in
 * production is ~1.1k characters, so this cap leaves real recipes untouched and
 * only sheds input that is pathological rather than a cooking step.
 */
export const MAX_CUE_SCAN_LENGTH = 2000
