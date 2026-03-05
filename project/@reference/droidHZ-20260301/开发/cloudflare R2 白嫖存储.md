# cloudflare R2 白嫖存储

- **Category**: 开发
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247483953&idx=1&sn=0bc2fe93be3cfb6e87ea5961376a974e&chksm=c28d266af5faaf7ca93c35e09f6b26bfa0d042dddefea8dfde492089aa96eea026fea17ac6b8#rd)

---

# 网站出海每日分享：cloudflare R2 白嫖存储

早上好，朋友们。
今天分享如何快速接入，cloudflare 的R2 存储，免费的10G存储，还是很香的。

首先需要cloudflare 需要绑定对应的域名服务器，如果已经绑定了vercel，他也能自动扫描对应的DNS，还是很方便的。

一、添加域名服务器：
1、主页添加域
2、输入你的域名
3、选择免费计划
4、检查DNS是否引入了，我的新域名就把所有的DNS移除了

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmlVxQG3lvL3kdbhib9MvYhW1ARhCHoWZiaUz9LMYibwID1n8w3LgSdEkIxg/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmlI0clSfTDXgE0BYJmcIO8LyeoRWic1YKTg8s66Y9icPIb24QNibOczXX6g/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmlDoPjDyEwJ72LhydLK8uIpqTBBQVOuXchu9mwYQa8AF8kmox4cnX0Vw/640?wx_fmt=png&from=appmsg)

5.绑定对应的域名服务器。我用的是spaceship ，选择NameServer ，自定义nameServer。输入前面cloudflare 的域名服务器地址。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmlEx302vAmmwrIHgODLQaicJHBd5dIZxg10ICy6kx3Rtt86LLiccQaKyQA/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmluxyjpocXYSbAneUFFe5ZChrdUCrgWhibn4QFI3HtibZMMkRmbyAg1rHQ/640?wx_fmt=png&from=appmsg)

6.等待域名服务器生效，我一般是10分钟，有时会久一些

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5XmlMO7BEZGC3q2T4GMHupp1oz2qPOKmXjvnXRcQTzTBZKUzHD4KibtNFicg/640?wx_fmt=png&from=appmsg)

二、创建存储桶
1、R2 对象存储->概述->创建存储桶
2、输入存储桶名称，就创建好了
3、一般需要绑定自定义域名，设置里面找到自定义域名

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5Xml7ggYlwjgVXW1oictILTFADmU0VFYVvoTsvjIiaiajmDo3xjYoz6kfWhQw/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcoQTuJibQJKUI9zVfTR5Xml3MbdibBsNvXpRpYu7DvHDiawPxmOw9G1PAuUqXc2UJic7QqDEicxhhhV5g/640?wx_fmt=png&from=appmsg)

4、输入自定义域名名称，为了不和域名发生冲突，需要用子域名的形式，这里直接输入即可，系统会自动配置DNS的。

5、预览DNS记录后，点击连接域，就已经绑定好了。
这样你就可以通过域名的形式访问到文件了。比如：https://cdn.vidflux.ai/veo-test.mp4
我是赫兹，一个专注「网站出海」的生意人。 想了解网站出海的朋友，可以去看看我之前的文章
 第一次赚美元！纯新手深度复盘网站出海，一文掌握全流程表情包还能这么用？怪不得进决赛还获奖了 聊天就能做出精美的网站，你上你也行 网站出海：技术重要，思维更关键——复盘深海圈“排学”的认知转变 网站出海就是一个种树的故事，浇水施肥，静待开花结果
