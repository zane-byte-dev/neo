# stripe 测试续费逻辑小技巧

- **Category**: 支付
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484539&idx=1&sn=6c559780d8d1280dbcb83692e232cb87&chksm=c28d2020f5faa9360d3d721689d1d14882f93caff289fce4362c5f521deaa828286720ffb8fe#rd)

---

# 网站出海每日分享：stripe 测试续费逻辑小技巧

分享一个测试stripe 续费逻辑的小技巧。
背景是我有个用户自动续费了，发现用户续费了，但是积分没有到账，修改了这个问题，但是这种场景很难测试。

没想到stripe的订阅时间，可以是一天，这样的话就可以自己设置一个一天的订阅，然后测试自动续费了，看到时候第二天续费订阅的时候，积分是否到账。大家初期的时候，就可以这样测试看看。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfmkduBxRQSfZmnhmYDTicYTIjGD3LF00IYF5Wl3Y1xS6OlnGJkTzWoaMmPQaHdfegIcL9WqAwibTYg/640?wx_fmt=png&from=appmsg)

如果是某些webhook 事件失败了，还可以在stripe的开发后台里面的webhook 重试一下

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfmkduBxRQSfZmnhmYDTicYTPDqaVvO0XqgU1B90bKZCVY7LEKrhANMPbuEtKRyvrxkXRgW2D1DmfQ/640?wx_fmt=png&from=appmsg)

我是赫兹，一个专注「网站出海」的生意人，这是我探索网站出海的第193天，每天都会分享网站出海的相关知识。 想了解网站出海的朋友，可以去看看我之前的文章合集。
网站出海每日分享网站出海深度总结
