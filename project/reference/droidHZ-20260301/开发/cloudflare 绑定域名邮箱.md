# cloudflare 绑定域名邮箱

- **Category**: 开发
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484046&idx=1&sn=5cd6101bbc8eaa493ca4f28d53a52481&chksm=c28d26d5f5faafc37f80a19bc8604b01dec859cea164162a2124a737f3697ff341a15f4431f0#rd)

---

# 网站出海每日分享：cloudflare 绑定域名邮箱

很多时候接入支付，是要求你网站绑定一个域名邮箱，那么怎么快速设置你的域名邮箱呢？

首先需要cloudflare 需要绑定对应的域名服务器，如果已经绑定了vercel，他也能自动扫描对应的DNS，还是很方便的。

一、添加域名服务器：
1、主页添加域
2、输入你的域名
3、选择免费计划
4、检查DNS是否引入了，我的新域名就把所有的DNS移除了

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269suuPWHnJ1aSX69W9jEOfdBdhpTANjU1IoJumCjlqAEl5L722JBo9yA/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269E34anAfRjrwNIp5bWPa121Hia0X5ONTW3GmQDJRyEz4OK3KePleQeicw/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269oIjT9NoicTbxFSLhXFE0qicuAKjIa5dnpEC2gaqYX4GS4OiaR5vicXTt6g/640?wx_fmt=png&from=appmsg)

5.绑定对应的域名服务器。我用的是spaceship ，选择NameServer ，自定义nameServer。输入前面cloudflare 的域名服务器地址。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269r3OyOeCicCy1SJMIUDcMTc0nWrMiabm9nPwA3xkUia8Jvd31WZIxiaTxVw/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269qTwBuV0PCBzAohHsGg0ZsU79T1NyUsOeeGHf80KGoHLVibPXChGLslA/640?wx_fmt=png&from=appmsg)

6.等待域名服务器生效，我一般是10分钟，有时会久一些

二、添加电子邮件转发
绑定完成后，在对应的电子邮件里面，开始使用电子邮件路由

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269oyGiaaPhGhLkQVu1FK1U1Ribx4ZZobV4VB0mw2MwZwQiaRgQbrNTmHcOw/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUdiay2zE0pVa0SH4ib7JSW269rE6HqbTejne9HUN2428ZNcGC9OMGf62cROpjiao9p2zibNA1rB6bsgvw/640?wx_fmt=png&from=appmsg)

然后输入邮箱的前缀，输入一个要转发到的邮箱。

之后就按照提示一直继续流程就创建好了。

这个方案创建邮箱很简单，也是免费，不过有个问题是，这里只是邮件的转发，不能使用这个邮箱去回复用户，适合初期审核网站快速添加联系方式。

初期可以直接使用这个方案，后续用户量起来了，需要用这个邮箱直接回复用户的时候，或者邮箱注册的时候。可以考虑使用cloudflare 的worker 或者 resend去发现邮箱，每天可以免费100封邮件，也可以考虑使用zoho去注册一个邮箱。
我是赫兹，一个专注「网站出海」的生意人。 想了解网站出海的朋友，可以去看看我之前的文章合集。
网站出海深度总结 网站出海每日分享
