# Rough-cut plan schema

Return exactly one JSON object:

```json
{
  "title": "short internal title",
  "summary": "one sentence explaining the rough-cut logic",
  "selected": [
    {
      "segmentId": "immutable input segment id",
      "role": "hook|evidence|benefit|specification|usage|usage_advice|social_proof|price|objection|experience|answer|action",
      "subtitle": "short faithful phrase",
      "cropMode": "wide|speaker|product|evidence",
      "reason": "why this segment is used"
    }
  ],
  "assetNeeds": [
    {
      "id": "asset-1",
      "role": "usage|product|evidence|transition",
      "queryZh": "Chinese search phrase",
      "queryEn": "English stock-library search phrase",
      "sourcePolicy": "enterprise|stock",
      "insertAfterSegmentId": "segment id or empty string",
      "durationSeconds": 2.5,
      "reason": "why this visual is needed"
    }
  ],
  "claimFlags": [
    {
      "segmentId": "segment id",
      "claim": "exact claim requiring review",
      "requiresConfirmation": true,
      "reason": "price, insurance, compensation, sales volume, certification, origin, health, safety or superlative"
    }
  ],
  "humanChecklist": ["specific review action"]
}
```

Constraints:

- Select 6–16 unique segment IDs. For a 60-second target, include enough distinct useful segments to approach the requested duration instead of returning a 30-second outline.
- Return selected segments in the exact order required by the chosen story template.
- Select complete sentences or complete semantic clauses; never select isolated filler or a fragment that depends on omitted context.
- Keep the estimated selected duration within the requested target plus or minus 20 percent.
- Use only provided segment IDs.
- Keep subtitles under 22 Chinese characters when possible.
- Return `assetNeeds: []` when source footage already supplies every needed visual.
- Return all strong claims in `claimFlags`, even when confirmed facts appear to support them; set `requiresConfirmation` to `false` only when the confirmed facts contain the same claim.
