# 课后探险队

在 **Bot 广场 → 团队模板** 选择「课后探险队」。打开新团队后可以从两个数学活动开始，也可以说出自己卡住的一步。点选活动直接打开对应练习。做完后选择「回到聊天写我的解法」，整理你自己的答案，再发给探险教练。

| 练习 | 适用册次 | 要完成的事 |
| --- | --- | --- |
| 十格种子 | 新版人教数学一年级上册第二单元 | 先预测已有 7 粒、要填满十格还差几粒。动手填满种子盘，再换一题并说出加法如何检验减法。 |
| 等式天平 | 新版人教数学七年级上册第五章 5.2 | 找出漏乘括号内第二项的步骤，对等式两边做同样的运算，代入核对，再独立解一道变式。 |

活动里的操作反馈由页面按题目规则即时给出。把答案和一句自己的解释发回聊天，教练按实际答复纠正错因、核对变式并留下复习卡。在同一线程继续可以接着读卡上的复习点。复习卡记录实际交到聊天里的尝试与解释。

## 课程和技能来源

课程对齐教育部公开章目和人教版新版教材介绍，互动题、图形与讲解为原创。学习流程参考 GitHub 的 `math-teacher`，复用其可视化与分层练习思路。「人教版数学小练习」是多文件 Agent Skills 包，包含 `SKILL.md`、两份互动资产、课程索引、教学提示、复习卡模板与来源许可。维护时修改 `examples/education` 中独立的 HTML、CSS 和 JavaScript，然后运行 `node scripts/sync-learning-assets.mjs` 更新网页和移动端共用的打包内容。[章目与来源](../examples/education/curriculum.md) · [Agent Skills 格式](https://agentskills.io/specification)

教育插件调研还核验了 Anthropic 与 Learning Commons 的 Apache-2.0 K–12 教师插件，其中的课堂诊断技能适合教师制作形成性评估。MIT 许可的 H5P Arithmetic Quiz 可用于已有 H5P 播放器的计算练习。[K–12 教师插件](https://github.com/anthropics/k12-teacher-skills/tree/31fd6dbb0c07cb50bb3ce7f62a4135a393bd0e8c) · [H5P Arithmetic Quiz](https://github.com/h5p/h5p-arithmetic-quiz/tree/d8cbe74b3f6c93190d85577e60200f5450b590b9)
