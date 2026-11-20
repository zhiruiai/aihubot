const el = (id) => document.getElementById(id);
function say(text) {
  el('feedback').textContent = text;
}
function screen(index) {
  for (let i = 0; i < steps; i++) {
    el('s' + i).classList.toggle('hidden', i !== index);
  }
  say('');
}
function on(id, run) {
  el(id).addEventListener('click', run);
}
function reflection(fact) {
  on('save', () => {
    const words = String(el('explain').value || '')
      .trim()
      .slice(0, 180);
    if (!words) {
      say('先说一句你的想法，再来整理。');
      return;
    }
    say('');
    el('summary').textContent = fact + ' 我想说：' + words;
    el('summary').classList.remove('hidden');
    el('back').classList.remove('hidden');
  });
}

const steps = 6;
let opened = 0;
on('w1', () => say('第一行只是展开左边的括号。右盘原封不动，先看三包里各有多少个单位。'));
on('w3', () => say('左盘每包都有一个 x。三包放在一起，共有几个 x？'));
on('w2', () => {
  screen(1);
  say('对。乘在括号外面的 3，要分别乘括号里的两项。');
});
function pack(i, label, visible = true) {
  const node = el('pack' + i);
  node.textContent = label;
  node.classList.toggle('hidden', !visible);
}
on('unpack', () => {
  if (opened >= 3) return;
  opened++;
  const node = el('pack' + opened);
  node.classList.add('split');
  node.textContent = 'x+1+1';
  el('diagram').textContent =
    '已拆 ' + opened + ' 包：合计 ' + opened + ' 个 x、' + 2 * opened + ' 个单位。';
  if (opened === 3) {
    el('formula').textContent = '3x + 6 = 21';
    el('unpack').classList.add('hidden');
    el('solve').classList.remove('hidden');
    say('三包合起来有三个 x 和六个单位。');
  }
});
on('solve', () => screen(2));
on('left', () => say('如果只从左盘取走 6，右盘仍有 21。要让两边相等，还要对右盘做什么？'));
on('both', () => {
  for (let i = 1; i <= 3; i++) pack(i, 'x');
  el('mass').textContent = '15';
  el('formula').textContent = '3x = 15';
  el('diagram').textContent = '两边各减 6，等式仍然成立。';
  screen(3);
});
on('minus', () => say('3x 表示三个 x 相加。减去 3 个单位，不能把三份变成一份。'));
on('divide', () => {
  pack(1, 'x');
  pack(2, '', false);
  pack(3, '', false);
  el('mass').textContent = '5';
  el('formula').textContent = 'x = 5';
  el('diagram').textContent = '代回检验：3 × (5 + 2) = 21。';
  el('divide').classList.add('hidden');
  el('minus').classList.add('hidden');
  el('verifyNext').classList.remove('hidden');
  say('三份平均分，每份是 5。把 5 代回原式，两边都等于 21。');
});
on('verifyNext', () => {
  pack(1, 'y + 3');
  pack(2, 'y + 3');
  pack(3, '', false);
  el('pack1').classList.remove('split');
  el('pack2').classList.remove('split');
  el('mass').textContent = '18';
  el('formula').textContent = '2(y + 3) = 18';
  el('diagram').textContent = '新的天平：每包换成一个 y 和三个单位。';
  screen(4);
});
on('t3', () => say('把 3 代回去，左边是 2 × (3 + 3) = 12。你的结果需要让左边等于 18。'));
on('t9', () => say('两边除以 2 得到 y + 3 = 9。还需要再做哪一步？'));
on('t6', () => {
  pack(1, 'y');
  pack(2, '', false);
  el('mass').textContent = '6';
  el('formula').textContent = 'y = 6';
  el('diagram').textContent = '代回变式：2 × (6 + 3) = 18。';
  screen(5);
});
reflection('等式天平：3(x + 2) = 21 得 x = 5，2(y + 3) = 18 得 y = 6。');
