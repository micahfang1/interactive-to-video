import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDuration, silentGaps, srtStamp, subtitleChunks, toSrt } from '../lib/subtitles.mjs';

test('字幕：按标点断开，短句并到一起，每条不超过上限', () => {
  const chunks = subtitleChunks('先猜一下。下面三件事，哪一件最像内卷？第一件，全班都在认真准备考试。', 12);
  // 「下面三件事，哪一件最像内卷？」并起来 14 个字，超过上限 12，所以拆成两条
  assert.deepEqual(chunks, ['先猜一下', '下面三件事', '哪一件最像内卷？', '第一件', '全班都在认真准备考试']);
  for (const c of chunks) assert.ok(c.length <= 12, `不超过上限：${c}`);
  for (const c of chunks) assert.ok(!/[，、；：。]$/.test(c), `结尾不留逗号句号：${c}`);
});

test('字幕：句号后面不往上并，哪怕并起来不超长', () => {
  assert.deepEqual(subtitleChunks('好。走吧。', 22), ['好', '走吧']);
});

test('字幕：逗号隔开的短句并成一条', () => {
  assert.deepEqual(subtitleChunks('一万块，每年涨百分之七', 22), ['一万块，每年涨百分之七']);
});

test('字幕：没有标点的长句原样保留，不会丢字', () => {
  const text = '这是一句完全没有标点而且长度远远超过上限的旁白';
  assert.deepEqual(subtitleChunks(text, 10), [text]);
});

test('字幕：空字符串和只有空白都得到空数组', () => {
  assert.deepEqual(subtitleChunks(''), []);
  assert.deepEqual(subtitleChunks('   '), []);
});

test('字幕：问号和感叹号保留在结尾', () => {
  assert.deepEqual(subtitleChunks('真的吗？真的！'), ['真的吗？', '真的！']);
});

test('时间戳：零、进位、超过一小时', () => {
  assert.equal(srtStamp(0), '00:00:00,000');
  assert.equal(srtStamp(1.5), '00:00:01,500');
  assert.equal(srtStamp(59.9996), '00:01:00,000'); // 四舍五入到毫秒后要正确进位
  assert.equal(srtStamp(3661.007), '01:01:01,007');
});

test('SRT：序号从 1 开始，条目之间空一行', () => {
  const srt = toSrt([{ from: 0, to: 1.2, text: '第一句' }, { from: 1.2, to: 2, text: '第二句' }]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,200\n第一句\n\n2\n00:00:01,200 --> 00:00:02,000\n第二句\n');
  assert.equal(toSrt([]), '');
});

test('估时长：字越多越长，标点不算字但算停顿，最短 1.2 秒', () => {
  assert.equal(estimateDuration('好'), 1.2);
  assert.equal(estimateDuration(''), 1.2);
  const plain = estimateDuration('一二三四五六七八九'); // 9 个字，每秒 5.4 字
  assert.ok(Math.abs(plain - 9 / 5.4) < 1e-9);
  assert.ok(estimateDuration('一二三四，五六七八九。') > plain);
  assert.ok(estimateDuration('一二三四五六七八九十一二三四五六七八') > plain);
});

test('没人说话的时段：开头、中间、结尾都能找出来', () => {
  assert.deepEqual(silentGaps([[10, 20], [40, 50]], 70, 5), [[0, 10], [20, 40], [50, 70]]);
});

test('没人说话的时段：短于阈值的不算，刚好等于阈值也不算', () => {
  assert.deepEqual(silentGaps([[3, 20], [25, 50]], 54, 5), []);
  assert.deepEqual(silentGaps([[0, 10], [15.01, 30]], 30, 5), [[10, 15.01]]);
});

test('没人说话的时段：重叠和乱序的区间先合并', () => {
  assert.deepEqual(silentGaps([[30, 60], [0, 40], [35, 45]], 60, 5), []);
  // 被长区间盖住的短区间不能把「说到哪了」往回拉
  assert.deepEqual(silentGaps([[0, 50], [10, 20], [58, 60]], 60, 5), [[50, 58]]);
});

test('没人说话的时段：全片没人说话就是一整段', () => {
  assert.deepEqual(silentGaps([], 30, 5), [[0, 30]]);
  assert.deepEqual(silentGaps([], 3, 5), []);
});
