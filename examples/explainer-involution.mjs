// 讲解型范例：《内卷》（Interflus 社科词条系列第 1 期）。动页本身没有人声，旁白是另写的。
// 这份脚本照原样跑不起来（要有这件动页的本地文件），拿来看写法：怎么分段、怎么让操作跟着旁白走。
// 用法：PAGE_URL=<动页地址> node lib/make.mjs examples/explainer-involution.mjs [--only 段id,段id]
// 每段：say = 旁白（同时是字幕），run = 这段旁白响着的时候在页面上做什么。t.at(0.5) = 等旁白说到一半。
// 相对动页原文的取舍（视频里效果不好的删掉或换做法）：
//   删：自由点人的剧场实验（滚动叙事已经讲完同一件事，自由点没有叙事）、学术定义三种、时间线其余六条、
//       后三个生活例子、其余五个误解、其余四道判断题、「这一页简化了什么」、出处。
//   改：稻田实验太高一屏放不下，拆成「田和读数」「两张曲线」两屏；先想一想那道题由旁白念选项、停两秒再揭晓。
const Z = 1; // 页面没有用 CSS 放大，坐标就是页面像素（1280×720）
const page = process.env.PAGE_URL; // 动页的地址：本地 file:// 或 http(s)://
const step = (i) => `.story-step[data-i="${i}"]`;
const storyStep = (i, say, extra = {}) => ({
  id: `story${i}`, say, ...extra,
  run: async (c) => { await c.scrollTo(step(i), { offset: 29, ms: 1300 }); },
});
const geertz = '#history .tl-item >> nth=1';
const comicNext = (root) => `${root} >> .comic-btn.next`;
const panel = (id, root, say) => ({ id, say, run: async (c) => { await c.click(comicNext(root), { ms: 500 }); } });

/** 稻田滑块：把「田里的人」拖到 n 人 */
async function setPeople(c, n) {
  const sel = 'figure[data-widget=paddy] input[type=range]';
  const box = await c.page.locator(sel).boundingBox();
  const cur = Number(await c.page.locator(sel).inputValue());
  const thumb = 20 * Z;
  const xOf = (v) => box.x + thumb / 2 + ((v - 1) / 11) * (box.width - thumb);
  const y = box.y + box.height / 2;
  await c.drag({ x: xOf(cur), y }, { x: xOf(n), y }, { ms: 1100 });
  const got = Number(await c.page.locator(sel).inputValue());
  if (got !== n) await c.page.locator(sel).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, n);
}

export default {
  slug: 'involution',
  url: page,
  brand: 'interflus.com',
  hideCss: '.progress, .masthead, .toc, .toc-toggle { display: none !important; }',
  // 滚动叙事在页面里是「滚到一步 → 锁住滚动、等读者读完卡片 → 再演这一幕」，节奏按阅读定的；
  // 视频里节奏跟旁白走，所以让它滚到就演（页面自己留的开关），不锁滚动
  setup: async (c) => { await c.page.evaluate(() => { window.__scInstantStory = true; }); },
  segments: [
    {
      id: 'open',
      say: '内卷这个词，现在人人都在用。可它到底指什么？加班算不算，竞争激烈算不算？这一期用一座电影院，把它讲清楚。',
      run: async (c) => { await c.wait(600); },
      gap: 0.6,
    },
    {
      id: 'hookq',
      say: '先猜一下。下面三件事，哪一件最像内卷？A，全班同学都在认真准备期末考试。B，老师要求论文写三千字，同学互相攀比，最后人人交八千字，优秀的名额没变。C，几家手机厂商竞争，手机一年比一年便宜好用。',
      run: async (c, t) => {
        await c.scrollTo('.hook-opt', { offset: 267, ms: 1400 });
        await t.at(0.2); await c.move('.hook-opt[data-i="0"]');
        await t.at(0.38); await c.move('.hook-opt[data-i="1"]');
        await t.at(0.78); await c.move('.hook-opt[data-i="2"]');
      },
      gap: 1.6,
    },
    {
      id: 'hooka',
      say: '答案是 B。投入涨了，能拿到的东西没变，谁少写谁吃亏。A 只是努力，C 是正常的竞争。区别在哪里，看电影院。',
      run: async (c) => {
        await c.click('.hook-opt[data-i="1"]');
        // 解析展开后页面变长了，页面里按滚动位置触发的东西（后面剧场的每一幕）要重新量一次位置，否则会错过
        await c.wait(900);
        await c.page.evaluate(() => window.dispatchEvent(new Event('resize')));
      },
    },
    storyStep(0, '大家本来坐着看电影，每个人都看得见。'),
    storyStep(1, '前排有两个人想看得更清楚，站了起来。'),
    storyStep(2, '他们身后的人被挡住了。坐着看不见，只好也站起来。'),
    storyStep(3, '再往后的人又被挡住。站起来的人一排一排往后传，过一会儿，几乎全场都站着看。', { gap: 1.2 }),
    storyStep(4, '现在每个人的视野，和大家都坐着的时候差不多。可是所有人都更累了。'),
    storyStep(5, '这时候你想坐下。可前面的人都站着，你一坐下，就什么都看不见了。', { gap: 0.9 }),
    storyStep(6, '所以靠哪一个人自觉都没有用。要有一条不许站的规则，全场才能一起坐下。', { gap: 1.2 }),
    {
      id: 'features',
      say: '从电影院里能看出内卷的三个特征。第一，能分的东西总量没变，银幕只有一块。第二，多出来的力气换不来真正的好处，你站起来，只是抵消了前面的人站起来。第三，很难单独退出，一个人坐下只会吃亏。',
      run: async (c) => { await c.scrollTo('#plain > .para.has-note', { offset: 127, ms: 1800 }); },
    },
    {
      id: 'three',
      say: '所以内卷不等于努力，也不等于竞争。竞争可以把饼做大。内卷是饼没有变大，大家在怎么分上越争越凶。判断的时候可以问三个问题：总量有没有变大？多出来的投入，换来的是真实的改进，还是只换来了排名？停下来的人，要付多大的代价？',
      run: async (c, t) => {
        await c.scrollTo('#plain > .para.has-note + p', { offset: 173, ms: 1200 });
        await t.at(0.42);
        await c.scrollTo('#plain .callout', { offset: 220, ms: 1200 });
      },
    },
    {
      id: 'origin',
      say: '这个词不是网上造出来的，它原本是人类学的术语。一九六三年，人类学家格尔茨用它描述印尼爪哇的稻田。',
      run: async (c, t) => {
        await c.scrollTo('#history h2', { offset: 100, ms: 1800 });
        await t.at(0.45);
        await c.click(`${geertz} >> .tl-head`);
        await c.wait(500);
        await c.scrollTo(`${geertz} >> .fig-comic`, { offset: 133, ms: 1000 });
      },
    },
    { id: 'java1', say: '一块固定的水田，先是两户人家耕种，产量够吃。', run: async (c) => { await c.move(comicNext(geertz)); } },
    panel('java2', geertz, '人口增长了。多出来的人本来可以进工厂，可是殖民地没有发展出工业。'),
    panel('java3', geertz, '他们只能回到同一块田里。插秧更密，除草更勤，活分得越来越细。'),
    panel('java4', geertz, '总产量上去了，可每个人分到的还是只够糊口。格尔茨把这叫作共享贫困。'),
    {
      id: 'javanote',
      say: '注意，这里的农民并没有互相攀比。这个词原来的意思是，内部越做越精细，结构却没有变化。攀比和竞争的意思，是二零二零年前后的网络用法加上去的。',
      gap: 0.8,
    },
    {
      id: 'paddy1',
      say: '可以自己往这块田里加人试试。现在田里有四个人。加到八个，再加到十二个。总产量一直在涨，每个人分到的却在慢慢变少。',
      run: async (c, t) => {
        await c.scrollTo('figure[data-widget=paddy] .paddy-scene', { offset: 40, ms: 1800 });
        await t.at(0.4); await setPeople(c, 8);
        await t.at(0.58); await setPeople(c, 12);
      },
    },
    {
      id: 'paddy2',
      say: '换成历史学家黄宗智的描述，下降得更明显。从第五个人开始，多加一个人多出来的产量，已经比雇一个短工的工资还低。可是家里人干活不算工钱，农户还是会继续加人。他把这叫作没有发展的增长。',
      run: async (c, t) => {
        await c.click('figure[data-widget=paddy] .seg button >> nth=1');
        await t.at(0.16);
        await c.scrollTo('figure[data-widget=paddy] .lab-controls', { offset: 73, ms: 1400 });
        await t.at(0.3); await setPeople(c, 4);
        await t.at(0.42); await setPeople(c, 6);
        await t.at(0.62); await setPeople(c, 10);
      },
      gap: 0.9,
    },
    {
      id: 'case1',
      say: '回到今天。两个人申请同一个岗位，名额只有一个，两人各有一段实习。',
      run: async (c) => {
        await c.scrollTo('#case-0 .fig-comic', { offset: 153, ms: 1900 });
        await c.move(comicNext('#case-0'));
      },
    },
    panel('case2', '#case-0', '小张多做了一段实习，小李一下子显得不够了。'),
    panel('case3', '#case-0', '小李补到三段，这回轮到小张显得不够。'),
    panel('case4', '#case-0', '最后两个人都做到三段，都比开始的时候累。名额还是一个，两人的排名和一开始一样。'),
    {
      id: 'casenote',
      say: '这和电影院是一回事：多出来的投入，很大一部分用来抵消别人的投入。不过也有不同，多学的知识、多做的实习，对自己还是有用的。所以要分开看，哪些投入只是为了排名，哪些本身就有价值。',
      run: async (c) => { await c.scrollTo('#case-0 .para.has-note', { offset: 200, ms: 1500 }); },
    },
    {
      id: 'myth1',
      say: '再说一个常见的误解：只要自己不卷，就能走出内卷。',
      run: async (c) => {
        await c.scrollTo('#myths .myth >> nth=5', { offset: 253, ms: 1900 });
        await c.move('#myths .myth >> nth=5 >> .myth-toggle');
      },
    },
    {
      id: 'myth2',
      say: '内卷是集体行动的困境。单个人退出只会吃亏，就像电影院里单独坐下的那个人。真正起作用的，通常是改规则，比如限制工时、改变评价的方式、增加名额。',
      run: async (c) => { await c.click('#myths .myth >> nth=5 >> .myth-toggle', { ms: 300 }); },
      gap: 0.9,
    },
    {
      id: 'quiz1',
      say: '最后判断两道题。第一道：几家外卖平台互相补贴，补贴越来越多，订单总量没怎么涨，商家和骑手的收入反而被压低了。这像不像内卷？',
      run: async (c) => { await c.scrollTo('#quiz .q >> nth=0', { offset: 200, ms: 1900 }); },
      gap: 1.5,
    },
    {
      id: 'quiz1a',
      say: '像。总量没有变大，补贴用来互相抵消，谁先停，谁就丢客户。',
      run: async (c) => { await c.click('#quiz .q >> nth=0 >> .q-opt[data-j="0"]'); },
    },
    {
      id: 'quiz2',
      say: '第二道：你给自己定了目标，每天加练，想把马拉松从四个小时跑进三小时四十五分。',
      run: async (c) => { await c.scrollTo('#quiz .q >> nth=3', { offset: 220, ms: 1400 }); },
      gap: 1.5,
    },
    {
      id: 'quiz2a',
      say: '这不算内卷，也不算竞争。你跑得更快，不会让别人吃亏，你也随时可以不练。这只是一个人的努力。',
      run: async (c) => { await c.click('#quiz .q >> nth=3 >> .q-opt[data-j="2"]'); },
      gap: 0.9,
    },
    {
      id: 'end',
      say: '这一期就到这里。视频里的电影院和稻田，在 Interflus 上都可以自己动手点、自己拖。另外还有四十期社科概念，囚徒困境、公地悲剧、幸存者偏差，都在那里。',
      tts: '这一期就到这里。视频里的电影院和稻田，在 Interflus 上都可以自己动手点、自己拖。另外还有四十期社科概念，囚徒困境、公地悲剧、幸存者偏差，都在那里。',
      run: async (c, t) => {
        await c.scrollTo('#further .related', { offset: 253, ms: 1800 });
        await t.at(0.5);
        await c.card('<h1>内卷</h1><p>这一页可以自己动手点、自己拖</p><b>interflus.com</b><p>一期一个社科概念 · 共 41 期</p>');
      },
      gap: 2.5,
    },
  ],
};
