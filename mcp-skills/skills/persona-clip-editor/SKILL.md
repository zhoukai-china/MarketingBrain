---
name: persona-clip-editor
description: Turn an authorized long-form talk, livestream, interview, or personal-brand source into several self-contained 30–120 second opinion/story rough cuts. Use for whole-video topic discovery, topic boundary detection, highlight selection, semantic compression, complete-sentence edit decisions, and subtitle-free exports for later finishing.
---

# Persona Clip Editor

Create several independent short videos from one long source. This is a topic-and-story workflow, not a commerce funnel and not silence removal.

## Workflow

1. Read the full word-timestamp transcript. Do not stop after the opening minutes.
2. Discover distinct topics. Start a new topic only when the central person, event, question, time period, conflict, or conclusion materially changes.
3. Give every topic one contiguous source range. Do not merge unrelated moments merely because they share a broad theme.
4. For each useful topic, build one 30–120 second short video from exact semantic-unit IDs.
5. Prefer this structure when the source supports it: emotionally strong hook → necessary context → story/reasoning → core insight → complete takeaway.
6. Export clean voice and picture without burned-in subtitles. The cutter adds subtitles, music, decorative text, and final styling in Jianying or another editor.

## Topic Rules

- A topic must stand alone for a viewer who has not watched the source.
- Preserve names, referents, and essential setup. Reject openings such as “他当时就这样” when the omitted context is required.
- Do not split one unfinished story into multiple topics because of a pause or digression.
- Do not combine separate stories into one video just to reach a duration target.
- Ignore greetings, repeated audience interaction, empty slogans, and operational livestream chatter unless they are necessary to understand the story.
- Return only boundaries backed by supplied unit IDs. Never invent timecodes, quotations, facts, or conclusions.

## Short-video Rules

- Use complete spoken thoughts as the smallest editing unit. Never cut after a comma, conjunction, setup phrase, or unresolved pronoun.
- Keep the speaker's original meaning and chronological logic. A strong later sentence may open the video only when it is understandable by itself; never repeat it later.
- Prefer emotionally infectious, surprising, specific, or sharply expressed source moments for the opening. Do not manufacture emotion with rewritten copy.
- Remove repetition and low-information detours first. Keep enough context for the conclusion to feel earned.
- Aim near the requested duration, but completeness is more important than hitting an exact second. A valid result must remain between 30 and 120 seconds unless the entire useful topic is shorter.
- Each selected unit must add context, development, evidence/example, insight, or closure. Avoid two units that say the same thing.
- End on a complete conclusion, lesson, reflection, or resolved emotional beat. Never end on a clipped syllable or a sentence that points to omitted content.
- Use natural framing by default. Occasional speaker close-ups may emphasize a genuine emotional beat; do not apply product/evidence crop logic.
- Do not burn subtitles into the rough cut.
- Do not optimize for evading duplicate-content detection.

## Output

Return JSON matching [references/plan-schema.md](references/plan-schema.md), without a Markdown wrapper.

## Human Handoff

The AI completes transcription, topic discovery, semantic compression, ordering, safe cut points, clean rough-cut rendering, and separate downloads. The cutter performs the final watch-through and adds subtitles, music, decorative text, optional B-roll, and platform-specific finishing.
