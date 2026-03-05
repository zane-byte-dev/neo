# 雷达设置,防止stripe封号

- **Category**: 支付
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247484991&idx=1&sn=ea79b2a209df88509b7df6b4a348e2a5&chksm=c28d2264f5faab72472c07a9e8d88915638b317dc15a45b41591a33df04e8c1c59643eaa6596#rd)

---

# 网站出海每日分享：雷达设置，防止stripe封号

早上好，朋友们！
最近看到有朋友，stripe 账号被坏人利用了，被封stripe 账号了，感觉挺影响心态的，刚好自己有2个stripe账号，另外一个也是忘记开通雷达了，今天也是设置上了，分享一下设置的过程。
雷达就是检测这个异常支付的，网站上你会发现有些用户是压根不使用积分，用非常多的卡去进行尝试购买。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfDeyiaxEnPwGicb7kkGgiaXtFDibmibeVn9jgLwH6fArzDvzvNdD43XfpDiaicEPIskibLibcP3xbBvCWvUKQ/640?wx_fmt=png&from=appmsg)

这种用户大概率就是盗刷的，如果用户找回自己的卡，发现莫名其妙被扣款，发起争议，这个时候你不仅要退款，还有支付20美元的争议费用，如果争议率或者异常支付过高，就会封你的stripe 账号。
怎么设置stripe 雷达？
在设置里面找到Radar ,升级到Radar 风控团队版

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfDeyiaxEnPwGicb7kkGgiaXtFxOv3blEwa5ciaj1T0EYydibmEKib5EkBbcHnEuc9CUUviccbRWAAAQjKRQ/640?wx_fmt=png&from=appmsg)

在产品->Payments->Radar-> 规则里面 添加规则。这里用的是哥飞群友分享的规则。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfDeyiaxEnPwGicb7kkGgiaXtFRqJLz9rlg5F5ZIUnyymuTEHibBWYQj25muXicjBnQaE2E4FkH6XcXGwg/640?wx_fmt=png&from=appmsg)

#3DS rules:card_3d_secure_support: = 'optional' and :risk_score: > 40:card_country: = 'PH' and :card_3d_secure_support: = 'optional'#block rules:refund_count_on_card_all_time: > 1:card_country: = 'PH' and :risk_score: > 30:dispute_count_on_card_number_all_time: > 0:card_count_for_customer_all_time: > 2:ip_country: = 'PH' and :risk_score: > 30:card_country: = 'PH' and :risk_score: > 30:card_country: ='SG' and :risk_score: > 40:card_count_for_ip_address_weekly: > 2:dispute_count_on_ip_all_time: > 0:efw_count_on_ip_all_time: > 0:card_count_for_ip_address_weekly: > 2:name_count_for_card_all_time: > 5#manual review rules::risk_score: > 30:cvc_check: = 'unavailable'然后就是分别在请求 3DS 验证、阻止、审查加上这些对应的规则。

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfDeyiaxEnPwGicb7kkGgiaXtFFdAurCDU4LmibptudldzjM8PFWaCHpkXqf8dYy11mia9UW5Kt0Kgrwfg/640?wx_fmt=png&from=appmsg)

然后我在风险控制哪里，还加上了阻止更多欺诈，把风险评分高于50的都阻止了

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUfDeyiaxEnPwGicb7kkGgiaXtFqAXx6tUSKAgFxRnABStsRhYGY36IibVZe7wrAqf2h16W1J15Z2fM6Ag/640?wx_fmt=png&from=appmsg)

我是赫兹，一个专注「网站出海」的生意人，这是我探索网站出海的第244天，定期会分享网站出海的相关知识。 想了解网站出海的朋友，可以去看看我之前的文章合集。
网站出海每日分享网站出海深度总结
