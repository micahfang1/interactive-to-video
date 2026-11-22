// 开箱能跑的示例：把旁边的 index.html（一页「钱多久翻一倍」的小动页）录成讲解视频。
// 用法（在你想放视频的目录下）：
//   node <本仓库>/lib/make.mjs <本仓库>/examples/demo/demo.mjs            # 没装配音就只出字幕
//   node <本仓库>/lib/make.mjs <本仓库>/examples/demo/demo.mjs --only guess,reveal
//
// 一份脚本就是一个对象：
//   url       动页地址；写相对路径就是相对这个脚本文件
//   hideCss   录的时候要藏掉的东西（导航、页脚之类）
//   segments  一段一段往下讲。say 是旁白（也是字幕）；run 是这段话期间在页面上做的事。
//             run 拿到 (c, t)：c 是操作（scrollTo / click / move / drag / wait），t.at(0.5) 是「等旁白说到一半」。

/** 把滑块拖到某个值：算出那个值在滑块上的位置，按住拖过去 */
async function dragSlider(c, selector, value) {
  const input = c.page.locator(selector);
  const box = await input.boundingBox();
  const [min, max, now] = await input.evaluate((el) => [+el.min, +el.max, +el.value]);
  const thumb = 20; // 滑块圆钮的大致宽度，圆钮走不到轨道的最两头
  const xOf = (v) => box.x + thumb / 2 + ((v - min) / (max - min)) * (box.width - thumb);
  const y = box.y + box.height / 2;
  await c.drag({ x: xOf(now), y }, { x: xOf(value), y }, { ms: 1200 });
  // 拖动落点差一格是常事：没到位就直接把值设过去，保证后面的旁白和画面对得上
  if (+(await input.inputValue()) !== value) {
    await input.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
}

export default {
  slug: 'demo',
  url: './index.html',
  hideCss: 'footer { display: none !important; }',
  segments: [
    { id: 'open', say: '每年涨百分之七，听起来不多。可是钱翻一倍，比你想的要快。' },
    {
      id: 'guess', say: '先猜一下：一万块，每年涨百分之七，多少年变成两万？十四年，十年，还是七年？',
      run: async (c, t) => { await c.scrollTo('#guess', { offset: 150 }); await t.at(0.75); await c.move('[data-years="14"]'); },
      gap: 1.2, // 这段说完多停一会儿，给观众想的时间（默认 0.45 秒）
    },
    {
      id: 'reveal', say: '很多人会选十四年。其实大约十年就够了。',
      run: async (c, t) => { await c.click('[data-years="14"]'); await t.at(0.6); },
    },
    {
      id: 'chart', say: '看这张图。每根柱子是一年，虚线是两倍。到第十年多一点，柱子过了线。',
      run: async (c, t) => { await c.scrollTo('#lab-title', { offset: 40 }); await t.at(0.5); await c.move('#chart'); },
    },
    {
      id: 'slow', say: '把涨幅拖到百分之三。三十年里，勉强翻了一倍。',
      run: async (c) => { await dragSlider(c, '#rate', 3); },
    },
    {
      id: 'fast', say: '再拖到百分之十二。六年就翻倍，三十年里翻了不止四次。',
      run: async (c) => { await dragSlider(c, '#rate', 12); },
    },
    {
      id: 'rule', say: '有个好记的办法：拿七十二除以涨幅。百分之十二，七十二除以十二，就是六年。和真实的数差不了多少。',
      run: async (c, t) => { await c.scrollTo('#rule-title', { offset: 110 }); await t.at(0.55); await c.move('#ruleRows tr.now'); },
    },
    { id: 'end', say: '这一页可以自己拖。换个数试试，看它多久翻倍。', run: async (c) => { await c.scrollTo('#lab-title', { offset: 40, ms: 900 }); } },
  ],
};
