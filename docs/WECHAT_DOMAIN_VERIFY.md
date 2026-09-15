# 微信「业务域名」校验文件（api.lcppch.top）

## 一、为什么需要它

公众号后台把「业务域名」填成 `api.lcppch.top` 后，微信会要求：在该域名根路径下能**直接**取到一串校验字符。
取不到时，用户从微信里打开 `https://api.lcppch.top/os-v2/...` 会先看到一张黄色安全提示页（**不是封禁**，点「继续访问」能进），
转化路径上多一道门槛。校验通过后，微信内长期不再提示。

只绑 `api.lcppch.top`。主域名 `lcppch.top` 解析到另一台机器（39.98.58.124）且证书已过期，验证必不过，弃用。

## 二、当前状态（2026-09-15 已上线）

| 项 | 值 |
| --- | --- |
| 校验文件 | `/var/www/wechat-verify/MP_verify_QnYOQF6cJVSpRYvk.txt`（16 字节，**无换行无 BOM**，内容 `QnYOQF6cJVSpRYvk`） |
| nginx 规则 | `/etc/nginx/conf.d/qiwx-bot.conf` 的 **443 server 块**内 `location ~ ^/MP_verify_[\w]+\.txt$ { default_type text/plain; root /var/www/wechat-verify; }` |
| 线上实测 | `https://api.lcppch.top/MP_verify_QnYOQF6cJVSpRYvk.txt` → **200 `text/plain`**，body 逐字等于 token；`http://` 走 301 → https 跟随后同样 200 |
| 运维脚本 | `scripts/ops/install-wechat-verify-file.sh`（装到 `/opt/baolu-ops/`，幂等，可重复执行） |

**红线**：这条 location 绝不能改成 `proxy_pass` 到 FastAPI、302 跳转或返回 HTML——微信校验失败 90% 卡在这三点。

## 三、以后再来新校验文件怎么办

```bash
# 服务器上（已装脚本）：
bash /opt/baolu-ops/install-wechat-verify-file.sh <新token>     # 写文件 + 确保 nginx 规则 + reload + 线上探测
DRY_RUN=1 bash /opt/baolu-ops/install-wechat-verify-file.sh     # 只看计划
```

脚本做的事：备份 nginx 配置 → 写 `/var/www/wechat-verify/MP_verify_<token>.txt`（`printf`，不带换行）→
（若尚未存在）把上面的 location 插到 443 server 块的 `server_name` 之后 → `nginx -t`（**失败自动回滚**）→ `systemctl reload nginx` →
线上探测（**带重试**，避开平滑 reload 抢跑的假 404）→ 打 `WECHAT_VERIFY_OK`。

因为 nginx 用的是正则匹配 `MP_verify_*.txt`，**换文件不需要再改 nginx**，只跑一次脚本即可。

## 四、验证与回滚

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://api.lcppch.top/MP_verify_QnYOQF6cJVSpRYvk.txt   # 期望 200 text/plain
curl -sS https://api.lcppch.top/MP_verify_QnYOQF6cJVSpRYvk.txt                                                   # 期望输出 token 本身
xxd /var/www/wechat-verify/MP_verify_QnYOQF6cJVSpRYvk.txt | tail -1                                              # 期望正好 16 字节
```

回滚：`cp -a /etc/nginx/conf.d/qiwx-bot.conf.bak-*-wechat-verify /etc/nginx/conf.d/qiwx-bot.conf && nginx -t && systemctl reload nginx`
（每次执行脚本都会自动生成一份带时间戳的 `.bak-*-wechat-verify` 备份）。

## 五、最后一步（需要人工）

龙哥在公众号后台「业务域名」页面点 **保存** → 提示验证通过即生效，之后微信内打开 OS-v2 不再弹安全提示。

## 六、踩坑记录（2026-09-15）

- 部署方（WorkBuddy）用 `workbuddy-deploy` 用户反复 SSH，但**服务器上并没有这个用户**，它连续试了 `ubuntu` / `ecs-user` / `workbuddy`
  等无效用户名，15 秒内 6 次失败 → 触发服务器 fail2ban（`maxretry=5 / findtime=600`），**把本机出口 IP 封了 22 端口 1 小时**，
  连带把 Codex 的发布通道一起封掉（现象是「上午能发布、下午突然连不上」）。详见 `docs/BUG_REGRESSIONS.md` QA-20260915-003。
- 因此本文件改用 Codex（root + 密钥）部署，并沉淀成上面的脚本；`jail.local` 的 `bantime` 已从 3600 调到 **600**，误封最多影响 10 分钟。
