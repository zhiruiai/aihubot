<h1 align="center"><img src="web/public/icon-192.png" alt="" width="88" height="88"><br><img src="docs/demo/office-cover.svg" alt="aihubot" width="960"></h1>

**简体中文** · [English](README.md)

**aihubot 是一个可以自托管的 Bot 工作空间。** 在聊天里交一份简报，打开交付物，告诉 Bot 哪个条件变了，再回到同一条对话核对新版。

[打开六件作品](https://zhiruiai.github.io/aihubot/work/) · [看实录与验收依据](docs/office-workflows.md) · [快速开始](#快速开始) · [下载客户端](https://github.com/zhiruiai/aihubot/releases/latest)

## 主厅关了，六场活动照办

主厅临时关闭，第一版排期有三处场地冲突。在原对话里更新闭馆和交场时间，项目协调员交回应急排期和可导入的日历。两版都能独立打开，可以逐文件看改动，也可以指定某一版继续修改。

[![aihubot 原对话与第二版应急排期并排呈现，六场活动均已通过约束核验](docs/demo/workspace-delivery-current.webp)](https://zhiruiai.github.io/aihubot/work/operations/)

截图来自独立演示空间。Rust 和 Pi 使用本机预设模型实际保存了虚构活动的两次交付。[查看版本对比截图](docs/demo/workspace-diff-current.webp) · [打开可操作成品](https://zhiruiai.github.io/aihubot/work/operations/)

## 创建 Bot 并拉进工作组

在 **Bot 广场** 打开一个模板，就能预览职责、长期指令和随附技能包。可以直接使用并打开单聊，也可以先编辑资料再创建。[Bot 模板说明](docs/bot-templates.md)

![aihubot 的 Bot 广场，正在预览研究员和它配套的技能](docs/demo/bot-gallery-current.webp)

从 **开始聊天 → 创建工作组** 按名称或职责找 Bot。继续搜索时可以看到已选成员，选齐就能从底部创建群聊。

<details>
<summary>查看三位 Bot 组建工作组的界面</summary>

![aihubot 的群聊创建界面，已选三位 Bot，底部保留创建按钮](docs/demo/create-group-current.webp)

</details>

## 从一道数学小题开始

在 Bot 广场使用「课后探险队」。一年级可以用十格种子理解十以内加减，七年级可以用天平找出解方程时的第一处错误。先动手，再独立做一道变式，把自己的解释写回原对话。[打开学习指南](docs/education.md)

## 开店前 72 小时，主力商品晚到了

雨壳要 96 小时才到，采购预算也从 ¥6,900 缩到 ¥5,500。采购 Bot 将三款商品从 **3 / 1 / 2 箱改为 1 / 3 / 2 箱**。打开采购台，切换交期和预算，对照预计毛利，再下载对应采购单。

[![六件实际交付作品的浏览器实录，从橘色雨壳采购台、咖啡竖屏短片到可复核的数据研究](docs/demo/work-studio.gif)](https://zhiruiai.github.io/aihubot/work/)

## 亲手试一次

点封面打开成品，无需登录。四组业务资料为虚构示例，选型与研究使用公开资料。每个案例都经过真实模型与 Rust 服务的交付、修改和复核。

| 经营与现场 | 内容与决策 |
| --- | --- |
| [![雨壳晚到，重新开采购单](docs/showcase-work/posters/commerce.jpg)](https://zhiruiai.github.io/aihubot/work/commerce/)<br>**[雨壳晚到，重新开采购单](https://zhiruiai.github.io/aihubot/work/commerce/)**<br>供应商延期与预算削减后，重算整箱件数、毛利和到货。 | [![把周末拍成一支 30 秒短片](docs/showcase-work/posters/editorial.jpg)](https://zhiruiai.github.io/aihubot/work/editorial/)<br>**[把周末拍成一支 30 秒短片](https://zhiruiai.github.io/aihubot/work/editorial/)**<br>从修订分镜到可播放、可下载的竖屏咖啡成片。 |
| [![主厅关闭，六场活动照办](docs/showcase-work/posters/operations.jpg)](https://zhiruiai.github.io/aihubot/work/operations/)<br>**[主厅关闭，六场活动照办](https://zhiruiai.github.io/aihubot/work/operations/)**<br>查看原排期与应急排期，把调整后的活动导入日历。 | [![夜读试点，投还是不投？](docs/showcase-work/posters/board.jpg)](https://zhiruiai.github.io/aihubot/work/board/)<br>**[夜读试点，投还是不投？](https://zhiruiai.github.io/aihubot/work/board/)**<br>翻看修正后的 600 席议案，检查盈亏线与退出条件。 |
| [![现场离线，中心多机写入](docs/showcase-work/posters/market.jpg)](https://zhiruiai.github.io/aihubot/work/market/)<br>**[现场离线，中心多机写入](https://zhiruiai.github.io/aihubot/work/market/)**<br>改变部署约束，看数据库选型何时翻转，逐条核查官方来源。 | [![一张会翻转结论的散点图](docs/showcase-work/posters/research.jpg)](https://zhiruiai.github.io/aihubot/work/research/)<br>**[一张会翻转结论的散点图](https://zhiruiai.github.io/aihubot/work/research/)**<br>检查 110 条原始观测，按物种拆开总体负相关。 |

## 快速开始

- **加入已有团队。** 在浏览器打开管理员提供的产品地址，也可在 Apple 芯片 Mac 或 Windows x64 连接客户端里输入同一地址。Windows 下载后请完整解压 ZIP。
- **自己部署。** Linux x64 服务包包含 Rust API、产品站、运营站和 Worker。按部署说明安装 Node.js 运行依赖，并设置私有数据目录。[Linux 安装说明](server/api/deployment/README.md#install-and-configure)
- **在这台 Mac 上执行。** 包含运行环境的 macOS 源码构建版可以启动本机个人空间，执行已授权的任务。公开下载的桌面连接客户端需要可访问的 aihubot 服务端。[桌面端说明](docs/desktop-client.md) · [下载版本](https://github.com/zhiruiai/aihubot/releases)

### 从源码运行

准备稳定版 Rust、Node.js 22.19 或以上版本，以及 npm。

```sh
git clone https://github.com/zhiruiai/aihubot.git
cd aihubot
npm ci
npm run configure:local
npm run dev
```

打开终端显示的产品地址。在 **设置 → 模型配置** 填写服务地址、模型名称和 API Key，保存后点 **设为默认**。Bot 会使用空间默认模型，也可以为某个 Bot 单独选择。

### 试做第一个任务

> 请把会议速记整理成 Markdown 行动清单，并把文件交回聊天。内容组周三交 12 篇指引，运营负责人周五收齐 5 份反馈，预算仍待确认。

打开文件卡片，再告诉 Bot「把 12 篇指引拆到周三和周四两批」。打开修订稿，检查总数是否仍为 12、预算是否仍为待定。想先体验文件交付，可运行 `npm run dev:preview`，使用预设模型和临时空间。[预览说明](CONTRIBUTING.md#run-a-sample-task-locally)

## 网站、技能和对外发布

- **交付网站。** 从聊天打开成品，对比修改，回看第一版，再回原线程继续改。版本历史动画展示了真实模型留下的交付记录，「星港降落」试玩来自预设对话。[版本回看实录](docs/demo/website-delivery.gif) · [试玩星港降落](https://zhiruiai.github.io/aihubot/zh.html)
- **安装并运行技能。** 在 Bot 设置中打开 **选择与管理技能 → 从技能库选择**。检查「数据质量核对」包内文件并安装，附上 CSV，在聊天中用 `/` 选择该技能。脚本会返回退出码和统计结果，执行端需要 Python 3 和本机命令权限。[技能包与脚本执行](docs/bot-models-and-skills.md)
- **策划与发文。** 「内容运营与发文」Bot 可以把推广简报做成运营方案和可下载的文章。连接知乎账号后，可以指定稿件存为知乎草稿或提交发布，再核对平台实际回执。[知乎发文流程](docs/zhihu-articles.md) · [发布账号](docs/publishing.md)

<details>
<summary>查看从本机导入技能时如何在安装前核对脚本</summary>

![本机技能包安装界面，展开包内说明和订单核对脚本](docs/demo/skill-package-current.webp)

</details>

## 架构与贡献

Web 与 Electron 共用 React 界面。Rust 管理任务状态、权限、回执及工作空间 SQLite 数据，Pi 在独立 Worker 中调用模型，工具执行由 Rust 校验。已授权的外部工具可通过 MCP 连接，移动端提供 Flutter 源码。[系统架构](docs/architecture.md) · [协议与能力范围](docs/capabilities-and-protocols.md)

项目原创代码使用 MIT 许可，随附的头像、技能和依赖保留各自许可。[贡献指南](CONTRIBUTING.md) · [报告问题](https://github.com/zhiruiai/aihubot/issues) · [安全反馈](SECURITY.md) · [MIT 许可](LICENSE) · [第三方声明](THIRD_PARTY.md)
