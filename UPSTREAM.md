# UPSTREAM

## 上游
- URL: https://github.com/yjh051108/dsh-agi-harness
- 角色: 上游原始项目，本仓库是它的私改分支。

## 本仓库
- 私有分支仓库: git@github.com:usernameisnotavailable159/dsh-agi-harness.git
- `origin` = 上游 `https://github.com/yjh051108/dsh-agi-harness`
- `mine` = 私有仓库 `git@github.com:usernameisnotavailable159/dsh-agi-harness.git`
- 手机路径: `~/projects/dsh-agi-harness`；profile 引用其中的 `plugins/dsh-browser-panel`、`plugins/dsh-closedloop-mode`、`plugins/dsh-engram-relay`

## 分支策略
- `compat-fixes`: 当前 Android/Termux 兼容分支，也是远端 `main`
- `main`: 本地旧 main，落后上游
- `upstream-main`: 上游最新 `main` 的镜像分支（远端）
- `origin/main`: 上游 `yjh051108/dsh-agi-harness`

## 同步策略
```sh
git fetch origin
git checkout compat-fixes
git merge origin/main          # 或按需 rebase
# 解决冲突后：
git push mine compat-fixes:compat-fixes
git push mine compat-fixes:main
```
- 合并上游时重点保留：
  - browser-panel 的 Android/Termux 适配（platform -> linux、Termux Chromium、TMPDIR、no-sandbox）
  - DSH 0.3 `webServer` 服务名适配
  - Playwright 懒加载
  - engram 的 cordis 依赖兼容
- 更新后重启 DSH web，确认三个 profile link 插件都能加载。

## 当前版本
- 本地兼容分支 `compat-fixes @ d268e24`
- 上游镜像 `upstream-main @ 0a17d30`
