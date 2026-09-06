export type BeautyTopicFailureCategory = "preflight" | "pollution" | "structure" | "validation" | "provider";

export interface BeautyTopicFailureResponse {
  status: 502;
  error: "beauty_topic_output_pollution" | "beauty_topic_output_structure_invalid" | "beauty_topic_output_validation_failed" | "beauty_topic_provider_failed";
  category: Exclude<BeautyTopicFailureCategory, "preflight">;
  message: string;
  retryable: boolean;
}

/** Maps internal terminal codes to stable, safe and actionable product errors. */
export function classifyBeautyTopicExecutionFailure(message: string): BeautyTopicFailureResponse | undefined {
  if (message.startsWith("provider_failure:") || message.startsWith("beauty_workflow_output_provider_failed:")) {
    return {
      status: 502,
      error: "beauty_topic_provider_failed",
      category: "provider",
      message: "模型服务本次未完成，已停止且不会自动重试；当前四来源资料仍保留，请稍后重新发起本轮选题。",
      retryable: true
    };
  }
  if (message.startsWith("beauty_workflow_output_foreign_module_failed:")) {
    return {
      status: 502,
      error: "beauty_topic_output_pollution",
      category: "pollution",
      message: "系统未生成有效选题：结果包含跨行业或内部测试标记，已安全拦截、未保存并释放预留积分。当前四来源资料仍保留，无需重复点击。",
      retryable: false
    };
  }
  if (message.startsWith("beauty_workflow_output_contract_failed:")) {
    return {
      status: 502,
      error: "beauty_topic_output_structure_invalid",
      category: "structure",
      message: "系统未生成有效选题：结果缺少正式 TOP10、四来源或三关筛选结构，已停止保存并释放预留积分。无需重复补已有来源或重复点击。",
      retryable: false
    };
  }
  if (message.startsWith("beauty_workflow_output_")) {
    return {
      status: 502,
      error: "beauty_topic_output_validation_failed",
      category: "validation",
      message: "系统未生成有效选题：结果未通过事实、完整性或正式质量校验，已停止保存并释放预留积分。当前来源资料仍保留，无需重复点击。",
      retryable: false
    };
  }
  return undefined;
}
