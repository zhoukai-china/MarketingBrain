# 提示词字段说明

- `intentUnderstanding`：用户可编辑的画面目标摘要，不增加新事实。
- `missingQuestions`：只问会改变主体、构图、授权或品牌准确性的内容。
- `positivePrompt`：连续的模型画面描述；不含费用、权限、审核和事实管理文案。
- `negativePrompt`：画面避免项；默认覆盖错误肢体、乱码、未授权标志和医疗效果对比。
- `overlayText`：中文叠字后期处理，绘图阶段只留安全区。
- `parameters`：供应商无关的视觉参数，交给后续 model adapter 映射。

方向变量建议：高级留白改变构图；真实材质改变写实与材质；温暖氛围改变色温。不得同时替换主体、场景和品牌。

最小合法 JSON 结构（实际输出至少 2 个方向，字段值按本次输入填写）：

```json
{"intentUnderstanding":"画面目标与硬约束","missingQuestions":[],"directions":[{"id":"direction-1","name":"方向名称","variable":"单一视觉变量","positivePrompt":"至少120字的连续可视画面描述","negativePrompt":"错误手部，扭曲面部，乱码中文，用户禁止项","overlayText":{"mode":"post_process","text":"","placement":"top_safe_area"},"parameters":{"purpose":"本次用途","aspectRatio":"本次比例","style":"本次风格","composition":"主体位置、层次与安全留白的具体描述","subject":"本次主体","scene":"不虚构事实的场景","lighting":"光线方向与质感","colorPalette":"主色与点缀色","camera":"镜头与景别","materials":"材质细节","clarity":"high"}}],"revisionSummary":"首次增强或本轮唯一变化","knowledgeStatus":"not_loaded","factBoundary":["仅使用已确认事实"]}
```
