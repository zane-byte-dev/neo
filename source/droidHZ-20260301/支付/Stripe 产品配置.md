# Stripe 产品配置

- **Category**: 支付
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484124&idx=1&sn=f410f74c2e97737a2793fceb2ba34a49&chksm=c28d2687f5faaf917a228476545df50c99221b1e33a9ea25370ab857ed7f1b7703a17974b80e#rd)

---

# 网站出海每日分享：Stripe 产品配置

早上好，朋友们，昨天分享了Stripe注册，今天分享一下stripe 产品配置 主要是 私钥，webhook，产品创建
找到私钥配置到环境变量中

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtWRvk0scM3by1Kwyxmicp8VRmLcS1IPS7uPkJovQEdUzr668wocWAJ4Q/640?wx_fmt=png&from=appmsg)

在左下方的开发人员找到webhook，打开后，选择添加事件

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQt3FQGzrAnEKuoXAgJ8vwRmzbh2iahXUvmQjSvhaKnRxg3aN3xxYyicQKg/640?wx_fmt=png&from=appmsg)

输入筛选要监听的事件
invoice.paidcheckout.session.completedcustomer.subscription.createdcustomer.subscription.updatedcustomer.subscription.deleted

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQt47cM0UfaOqEptPf1LN3uVMnj2LZ2UuaybW66zsoyQUI6TweZdJzdAw/640?wx_fmt=png&from=appmsg)

选择创建webhook 端点，输入一个名称，和对应 Webhook URL

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtuRUiaicbzl3Y2Tx1HymQV7rjg5VleO43Og3WQMndosnpzQhLwGoibpkKA/640?wx_fmt=png&from=appmsg)

image.png创建完成之后，就可以复制对应webhook的密钥后续去使用

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtCdXibh21NZpIDK4332xX9BRBtzRobaxQah5N888wbXgkgfZjpQ5ISAw/640?wx_fmt=png&from=appmsg)

创建对应的产品，在产品目录里面，选择创建产品

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtY4tCXumsGAuQ6gmgVWxX6DFuVp898leOzfHL9Trv8WY2jpQfIfcaqg/640?wx_fmt=png&from=appmsg)

输入是名称，对应是订阅还是一次性收费，注意收费的币种，选择是按月收费还是按年收费

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtqMdAsyQ9iarGUEvZAeeD7QUZFKxcukds0Y5DJWIiamINs7IWUjtnQ0Sw/640?wx_fmt=png&from=appmsg)

复制你的价格id 到环境变量里面

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQteQu6xzlTuG25v6ibbFQ4CbygmmoTseTaBPKPjRrSyac7mEUU5rtQNMg/640?wx_fmt=png&from=appmsg)

本地测试的话，可以使用Stripe CLI 本地转发

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfYHMIHXRHQZemursL31lQtmop4RSagwUJjxPEqpQuLLNYWdNZRubDc9TiagmUX72ppNglMThsRRvg/640?wx_fmt=png&from=appmsg)

沙盒环境，是有对应的虚拟卡可以测试支付  https://docs.stripe.com/testing
4242 4242 4242 4242 - 成功支付4000 0000 0000 3220 - 需要 3D 安全认证4000 0000 0000 9995 - 资金不足失败我是赫兹，一个专注「网站出海」的生意人。 想了解网站出海的朋友，可以去看看我之前的文章合集。
网站出海深度总结网站出海每日分享
