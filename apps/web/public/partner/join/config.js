/* 思潼AI商城 · FDE 合作登记页部署配置（2026-10-08 周凯部署）
   api  : 登记提交接口（公开）
   list : 后台拉取接口（鉴权走 FDE_ADMIN_KEY，页面运行时输入，绝不写进本文件）
   注意：本文件公网可读，任何密钥都不能放这里（2026-10-08 修复：移除误写入的 STZ_ADMIN）。 */
window.STZ_CONFIG = {
  api:  "https://ai.lcppch.top/api/fde/register",
  list: "https://ai.lcppch.top/api/fde/list"
};
