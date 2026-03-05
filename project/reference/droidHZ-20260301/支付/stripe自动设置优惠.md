# stripe自动设置优惠

- **Category**: 支付
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484292&idx=1&sn=1969b605a8b0bd47262099359f65b911&chksm=c28d27dff5faaec9b5f0500e374420c45f50b8e863e81cd99fa4bb5fab4782dcc999d0099b4b#rd)

---

# 网站出海每日分享：stripe自动设置优惠

早上好，朋友们！
今天分享如何使用stripe 设置优惠，在用户购买时，自动设置上优惠码，无需手动填写(如需手动填写，可以直接设置allow_promotion_codes为true，用户可以填写上自己得到的优惠码)。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcfBQFXcPodjHViarC3ZErTVDJ5A2UcfuVv9H92Vjk6BPiadbv1ejBeZdOZzbucefzHZu1TquKiaia2Xw/640?wx_fmt=png&from=appmsg)

首先是stripe平台上新增一个优惠券，然后填写上优惠名称，折扣，持续次数

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcfBQFXcPodjHViarC3ZErTVCy6dv1p5Yt7L26At8xrRxrPEajhvxS4ISAZ5QlSM8aIAe0hVGf93CQ/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcfBQFXcPodjHViarC3ZErTVBJ0kkuSfKVlwee2sKLKXXIqlnzf7ql6bjfWAZMOZicbh2icSW4aPz30g/640?wx_fmt=png&from=appmsg)

创建完成后，需要在stripe的支付代码的checkout逻辑里，添加上discounts信息和优惠码id，注意一定要去掉allow_promotion_codes，否则请求支付时，会报错。
官方参考文档：
https://docs.stripe.com/payments/checkout/discounts

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUcfBQFXcPodjHViarC3ZErTV5NtMRDAGzOzrN6IJFkybLSHA4h4vzibKicBqgGiaR91BbiafcQmhKO92gQ/640?wx_fmt=png&from=appmsg)

我是赫兹，一个专注「网站出海」的生意人，这是我探索网站出海的第162天，每天都会分享网站出海的相关知识。 想了解网站出海的朋友，可以去看看我之前的文章合集。
网站出海每日分享网站出海深度总结
