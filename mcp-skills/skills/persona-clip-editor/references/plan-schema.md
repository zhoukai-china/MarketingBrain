# Persona Batch Plan Schema

The topic discovery response uses:

```json
{
  "topics": [
    {
      "title": "short factual title",
      "summary": "what this topic is about",
      "startWindowId": "exact supplied window id",
      "endWindowId": "exact supplied window id",
      "whyIndependent": "why this is a standalone story or opinion"
    }
  ]
}
```

The per-topic edit response uses:

```json
{
  "title": "short title",
  "summary": "one sentence summary",
  "selected": [
    {
      "unitId": "exact supplied unit id",
      "role": "hook|context|story|reasoning|insight|takeaway",
      "reason": "why this original spoken unit is retained",
      "cropMode": "wide|speaker"
    }
  ]
}
```

Use only supplied IDs. Do not return rewritten dialogue or invented timestamps.
