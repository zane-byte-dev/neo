# 创建一个claude skill 减少重复操作

- **Category**: 开发
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484820&idx=1&sn=259adf45f1e4a8feaede9ef97a0aa1ad&chksm=c28d21cff5faa8d9fdb1294a497f1c89e31d897293e955a8101e3224936485aa93f8e3b7067e#rd)

---

# 网站出海每日分享：创建一个claude skill 减少重复操作

**作者**: droidHZ  
**日期**: 2026年1月4日 08:32

早上好，朋友们！

今天分享一下使用 skill creator 创建一个 skill 。

这个 skill 是我开发过程中，比较常见的操作，就是网页上需要图片，我需要自己手动去使用 nano banana 去生成网页所需要的图，挺耗费时间的。现在有了 skill ，这部分工作也可以让 claude code 自己去完成了。

来看看是怎么创建吧。

常规是需要在 claude.ai 里面 的头像 -> setting -> capabilities -> skills 把 skill creator 打开，然后让 cc 使用 skill creator 创建即可。但是我用的拼车，禁止访问官网的，我看会报错。

就需要手动去把 skill creator 从 github 下载下来放到对应的配置文件目录下，如果不知道目录，可以问一下 cc ，我的是在用户主目录的 `.claude/skills/` 文件夹里面。

之后就可以正常创建 skill 了，描述你的需求即可。
**比如**: "使用 skill creator 创建一个生成图片的 skill, 需要调用我自己的 api 去生成图片。对应生成图片的文档是 `d:\code\mksaas-template\docs\nano-api.md`。"

因为需要调用 api 需要知道如何调用，我就把 kie 的文档也提供给它了。

然后就会问你一些问题，按照你的选择进行选择即可。生成完成之后，你可以在同样的 skills 文件夹里面找到新生成 skill。

然后就可以使用 you 新创建的这个 skill 了，这里我就一句话生成了一个测试页面，包含图片：
"帮我新增一个 photo to video landing page 页面， 页面 feature 需要的图片使用 nano-image-generator skill 进行生成"

我测试的网页 cc 就可以自己生成加上图片了。

我是赫兹，一个专注「网站出海」的生意人，这是我探索网站出海的第222天，定期会分享网站出海的相关知识。 想了解网站出海的朋友，可以去看看我之前的文章合集。

- [网站出海每日分享](https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzkzNzYzNzE3Mg==&action=getalbum&album_id=4164560801283358741#wechat_redirect)
- [网站出海深度总结](https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzkzNzYzNzE3Mg==&action=getalbum&album_id=4081115709248290826#wechat_redirect)

---
**提取摘要**: 文章介绍了如何通过 skill creator 为 Claude Code (cc) 创建自定义技能（skill），用于自动化生成网页图片。由于作者使用拼车服务无法直接访问官网，采取了手动将技能文件放入 `.claude/skills/` 目录的方案。通过提供 API 文档，成功创建了 `nano-image-generator` 技能，并实现了通过指令自动生成带图的落地页。