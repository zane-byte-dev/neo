# API调试

- **Category**: 开发
- **URL**: [Link](http://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247483881&idx=1&sn=dd38923efa0bf23e857cc725a8a9cfde&chksm=c28d25b2f5faaca4ea0849163f5c681ef2845b426a91cdcd9fec036550fb86b99928dab7ff57#rd)

---

# 网站出海每日分享：API调试

早上好，朋友们！
今天分享postman 调试api ,避免你用AI的代码测试了半天，你一直怀疑是代码有问题，结果发现是平台或者某些参数错误。通过post测试就能减少这类坑点。

打开https://www.postman.com/ ，然后登录。

选择send request

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8YkpfR98BtMHRGPl8XqibAREQ1E739J5AWToSpPYxRM6GyS8ictpePPJxw/640?wx_fmt=png&from=appmsg)

我们以fal调用nano banana 为例。
先在官网找到curl 请求，然后复制调用示例

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8Yw7OCqcGJFFIdx58VTMZjawYOD2gakQECcaVmbeeyZ04YChsTVhdEug/640?wx_fmt=png&from=appmsg)

输入复制的curl 请求，到postman网站，找到import ，粘贴对应的curl，比如这里就是 
curl --request POST \--url https://queue.fal.run/fal-ai/gemini-25-flash-image/edit \--header "Authorization: Key $FAL_KEY" \--header "Content-Type: application/json" \--data '{"prompt": "make a photo of the man driving the car down the california coastline","image_urls": ["https://storage.googleapis.com/falserverless/example_inputs/nano-banana-edit-input.png","https://storage.googleapis.com/falserverless/example_inputs/nano-banana-edit-input-2.png"]}

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8YPur4JGrJxBCHUb9v2FlCvq1sW8NlxvJW3vA2H4iaQZHyNawsWdAiaBDA/640?wx_fmt=png&from=appmsg)

可以选择保存或者不保存，我选择保存到test的合集

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8YdgNzIZsrNEIh0Yo4r7qfajw3CH6j9sxrcRcoY3ZVUEMk24lF49WAyQ/640?wx_fmt=png&from=appmsg)

现在就导入成功了，看到这里需要有个$FAL_KEY，我们把这里替换为对应的key

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8YtjzFVpnVNicAHpzVkmE8WGUtLPoWdcnGzDgqhdBVI2XrgYx27syoOoQ/640?wx_fmt=png&from=appmsg)

key添加完成后，点击send 就可以看到对应的请求了，不过这里是异步的，只返回的request_id
，按照同样的方式，我再调用api里面另外一个接口请求就能获取结果了

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8YE7ox2V1ErxFQ4XkH6OGUofQVIOvebfdBdLUhyLvrm5L22WL6ffo9ug/640?wx_fmt=png&from=appmsg)

![image](https://mmbiz.qpic.cn/mmbiz_png/gG3yexRibCUesrYOSicEmIua5Il8yrHu8Yxt1wWCN00Zsl4zZGSBaJgw0VEUttkbxLNhBObEhLyoRk5TABqtub0g/640?wx_fmt=png&from=appmsg)

我是赫兹，一个专注「网站出海」的生意人。 想了解网站出海的朋友，可以去看看我之前的文章
 第一次赚美元！纯新手深度复盘网站出海，一文掌握全流程 聊天就能做出精美的网站，你上你也行网站出海：技术重要，思维更关键——复盘深海圈“排学”的认知转变 网站出海就是一个种树的故事，浇水施肥，静待开花结果
