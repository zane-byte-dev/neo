const SIMPLE_INDICATORS_ZH = ['你好', '谢谢', '好的', '嗯', '是的', '嗨'];
const SIMPLE_INDICATORS_EN = ['hello', 'hi', 'thanks', 'thank you', 'ok', 'okay', 'what is', 'define'];
export const SIMPLE_INDICATORS = [...SIMPLE_INDICATORS_ZH, ...SIMPLE_INDICATORS_EN];

const CODE_GENERATION_ZH = ['写代码', '实现', '函数', '组件', '接口', '类', '代码'];
const CODE_GENERATION_EN = ['implement', 'function', 'class', 'component', 'api'];
export const CODE_GENERATION_KEYWORDS = [...CODE_GENERATION_ZH, ...CODE_GENERATION_EN];

const MULTI_STEP_ZH = ['第一步', '第二步', '然后', '接着', '最后', '分步'];
const MULTI_STEP_EN = ['step 1', 'step1', 'workflow', 'first', 'then', 'finally'];
export const MULTI_STEP_KEYWORDS = [...MULTI_STEP_ZH, ...MULTI_STEP_EN];

const ANALYTICAL_REASONING_ZH = ['分析', '对比', '比较', '权衡', '利弊', '影响', '分析一下'];
const ANALYTICAL_REASONING_EN = ['compare', 'analysis', 'trade-offs', 'implications'];
export const ANALYTICAL_REASONING_KEYWORDS = [...ANALYTICAL_REASONING_ZH, ...ANALYTICAL_REASONING_EN];

const CONSTRAINT_ZH = ['至少', '不超过', '必须', '严格', '仅限'];
const CONSTRAINT_EN = ['exactly', 'at least', 'at most', 'must', 'no more than', 'within'];
export const CONSTRAINT_KEYWORDS = [...CONSTRAINT_ZH, ...CONSTRAINT_EN];
