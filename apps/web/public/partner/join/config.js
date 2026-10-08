/* 思潼AI商城 · FDE 合作登记页部署配置（2026-10-08 周凯部署）
   api  : 登记提交接口（已上线）
   list : 后台拉取接口（管理后台用）
   token: 接口鉴权密钥 = 管理后台访问口令（保禄本地管理后台 config.js 填同一个）
   本文件被登记页/管理后台共用，改一处即可。 */
window.STZ_CONFIG = {
  api:  "https://ai.lcppch.top/api/fde/register",
  list: "https://ai.lcppch.top/api/fde/list"
};

window.STZ_ADMIN = {
  pwd: "fde-0599d2ddd9c86cea",
  token: "fde-0599d2ddd9c86cea"
};
