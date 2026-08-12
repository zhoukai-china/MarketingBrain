---
name: commerce-clip-editor
description: Turn one or more authorized product or livestream clips into a reviewable short-form commerce-video rough cut. Use for high-moment discovery, semantic clip selection, conversion-oriented sequencing, dynamic crop instructions, B-roll requirements, strong-claim checks, human review tasks, and a structured edit decision list before MCP rendering.
---

# Commerce Clip Editor

Produce a conservative rough-cut plan. Treat the provided source segments and confirmed product facts as the only factual basis.

## Three-layer Workflow

1. Understand: use word-timestamp ASR for what is said and frame/OCR analysis for what is visible. Never infer a visible label or proof from speech alone.
2. Build content blocks: classify complete semantic units as hook, evidence, benefit, specification, usage, usage advice, social proof, price, objection, experience, answer, or action.
3. Assemble: semantically compress a 5–10 minute source into a 30–60 second story using the selected template. This is not silence removal. Select only exact segment IDs and never invent timecodes, quotations, product facts, footage, testimonials, or endorsements. Do not pad a strong 35–45 second cut with low-information speech merely to reach 60 seconds.
4. Find highlights before assembling: rank complete source moments by buyer value, genuine emotion, on-camera demonstration, concrete contrast, or a clear question/answer. A highlight is evidence for selection, not a prediction of conversion.
5. Finish: only after the structure passes validation, add crop instructions, approved B-roll, low-volume background music, and a deliberate ending. Do not burn subtitles into the rough-cut export; the cutter will add or revise them in the finishing editor.
6. Assign one crop mode to each selected segment:
   - `wide`: preserve person and product context.
   - `speaker`: place the face and upper body prominently.
   - `product`: focus on the product body without cutting off labels.
   - `evidence`: focus on an approved label, certificate, number, or proof object.
7. Request B-roll only when it adds visible proof or a useful usage scene. Use `enterprise` for exact product, packaging, certificates, insurance, prices, sales numbers, or brand evidence. Use `stock` only for generic actions such as cooking, frying, pouring oil, or making dumplings.
8. Mark all prices, discounts, compensation, insurance, certification, sales volume, health, safety, origin, and superlative claims as `requiresConfirmation` unless they appear in the confirmed facts.
9. Return JSON matching [references/plan-schema.md](references/plan-schema.md), with no Markdown wrapper.

## Story Templates

- `evidence_conversion`: forceful product identity → visible trust proof → specification → social proof when present → price → concrete benefit → usage scene → sensory experience → objection handling when useful → action.
- `experience_recommendation`: hook → experience → benefit → usage → evidence → price → action.
- `audience_fit`: audience problem → answer → benefit → specification → evidence → usage → price → action.
- `question_answer`: customer question → direct answer → evidence → benefit → objection/limitation → price → action.

## Editing Rules

- Put the product identity in the first sentence and preferably the first second. The opening should sound like a declaration, not an explanation. A source sentence that names the product and immediately gives a visible trust claim may stay intact, but the claim must be flagged for confirmation.
- Prefer a high-energy/high-information source moment for the opening only when it also names the product or product category. Strong delivery, a readable package, an on-camera demonstration, a concrete contrast, or an exact buyer benefit can raise the opening's priority; nostalgia or a disconnected excited sentence cannot outrank a direct product declaration.
- Every selected segment must add a new fact, objection answer, scene, or action. Do not repeat the same selling point in different words.
- De-duplicate by fact identity, not wording alone. Two clips that repeat the same capacity, weight, price, insurance, compensation, certification, origin, or sales proof are one beat even when the surrounding sentence is different. Keep the clearer, stronger, better-supported version and spend the saved time on a new conversion stage.
- Treat the requested duration as a range, not a reason to keep weak speech. For a 45–60 second target, retain all strong non-repetitive conversion stages, but a complete 35–45 second cut is preferable to a padded 60-second cut. Remove filler, repeated slogans, long memories, and general explanations before removing product identity, proof, specification, price, usage, sensory value, or action.
- Use one original completed spoken sentence or merged semantic unit as the basic audio-edit unit. Usually advance one conversion idea every 2–4 seconds; use a shorter beat only when the source itself ends in a complete, viewer-facing statement. Never split a dependent comma clause to force pace. For `evidence_conversion`, use the order learned from the approved human reference: direct product declaration, trust/proof, specification and social proof, price, usage and sensory value, then action. A proof claim can appear immediately after product identity, but it must remain review-gated.
- Use complete semantic units with exact word timestamps. Reject isolated filler, dangling pronouns, and fragments that depend on omitted context. An ASR chunk ending in a comma is never an edit boundary by itself: join its directly adjacent continuation until the speaker completes the thought. A full stop is allowed only when the selected audio itself ends on its final word; never let audio from the following unselected sentence leak into the shot.
- Reject low-confidence semantic units even when punctuation looks complete. Contradictory double negatives, repeated malformed phrases, or a clause whose meaning cannot be stated confidently must be omitted from the rough cut; do not “repair” uncertain speech by guessing words. Optional social-proof or objection asides shorter than a stable shot should also be omitted instead of creating a flash cut.
- Follow the chosen template order exactly. Missing required stages become explicit quality flags; never hide them by re-labeling unrelated speech.
- Change the visual focus every 2–4 seconds when useful; do not create constant random zooms. Product identity, readable label, proof, specification and price should normally use a direct already-cropped product/detail shot. Explanations and the final call to action should return to a person-with-product or naturally framed speaker shot.
- Build visual progression as well as semantic progression. In the opening 8–12 seconds, prefer `product establishing shot → proof/detail close-up → person-with-product/specification`. Do not use the exact same source interval twice, and do not preview a proof/detail shot as hook coverage when that same shot is scheduled in the next one or two beats. If the strongest opening audio has an unstable picture, retain the original voice but cover it with a different stable product shot from the authorized source; reserve the proof close-up for the proof sentence.
- When one segment's voice is covered by another source moment, crop to the product, label, hands, or environment; do not leave a clearly speaking mouth visible with unrelated audio. Never stretch coverage by freezing the last frame or visibly looping a short clip. Select a long-enough alternate product moment or let a verified continuous source shot run.
- Treat consecutive shots as visually repetitive when they reuse the same source interval, nearly identical frame description/OCR target, crop mode, and framing without adding a deliberate closer detail. Resolve repetition by selecting a different authorized moment, changing from establishing to detail or from detail to person-with-product, or shortening the weaker repeated beat. Never solve it with decorative zoom animation alone.
- Keep the product readable. Never mirror footage when it reverses labels or evidence text.
- Evidence crop is allowed only when OCR/frame analysis confirms that the claimed proof is visible in the same segment. Otherwise request a matching enterprise asset.
- Prefer hard cuts. Do not zoom every shot and do not show a mechanical zoom-in process by default. Use an already-cropped direct close-up at deliberate conversion beats: product identity, readable label/proof, specification, sales proof, or price. Keep conversation, explanation, objection handling, and the final action naturally framed. Use full-screen B-roll for usage scenes while retaining the original voice track; use picture-in-picture only when both speaker and evidence must be visible simultaneously.
- Treat full-screen B-roll as the default for cooking, pouring, serving, texture, and product-beauty shots. Picture-in-picture is an exception, not a decorative default.
- A direct close-up must be focus-aware and leave enough edge room for product labels and expressions. It is a scene cut, not a permanent visual effect.
- Keep background music below speech with automatic ducking. Use only a track with recorded commercial-use permission and source metadata.
- End on a complete action or closing sentence that names or clearly points back to the product. When suitable authorized footage exists, let the final seconds follow the reference rhythm: usage/product B-roll, then return to a useful person-with-product or product frame. Hold that useful frame briefly; never fade the picture to an empty black frame, stop on a clipped syllable, or hard-cut music.
- Do not optimize for bypassing duplicate-content detection.
- When the source cannot support a requested statement or visual, create a missing-asset or missing-fact task instead of filling the gap.

## Human Gate

Require human confirmation before rendering when any strong claim is unconfirmed or any asset lacks an explicit license/source record. The human approves the EDL, claim list, crop targets, and B-roll choices before final export.
