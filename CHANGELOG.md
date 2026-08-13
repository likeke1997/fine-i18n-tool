# Change Log

All notable changes to the "fine-i18n-tool" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.9]

- 增加 Feishu Branch Lens：解析任务编号分支，通过 Feishu Project MCP 查询标题，并支持标题搜索与分支切换
- 支持 OAuth 设备授权、VS Code SecretStorage、24 小时标题缓存和同任务并发请求合并
- 兼容新版 VS Code / Cursor Git API，修复本地分支列表为空的问题
- 将国际化扫描移到后台，确保“飞书功能分支”入口和点击命令立即可用

## [0.0.8]

- v0.08 支持从 iconfont TTF 文件读取编码并显示图标行内提示，默认匹配 `icon-[xxxx]` 和 `fdl-icon-[xxxx]`
- v0.07 调整i18nFileSuffix默认配置
- v0.06 更新扩展名称
- v0.05 支持展示工作区信息
- v0.04 支持JSON格式的国际化文件
- v0.03 提供i18nFileSuffix和i18nFuncName配置项
- v0.02 修复国际化自动补全触发时机错误的问题
- v0.01 实现国际化提示和自动补全功能
- Initial release
