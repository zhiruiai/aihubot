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

const steps = 4;
let planted = 0;
on('p2', () => say('看看下面一排。可以用手指从左到右，一格一格点过去。'));
on('p4', () => say('上面一排已经满了。只数下面一排没有种子的格子。'));
on('p3', () => {
  screen(1);
  say('你猜还要 3 颗。亲手种一遍来检查。');
});
on('plant', () => {
  if (planted >= 3) return;
  planted++;
  el('c' + (7 + planted)).classList.add('new');
  el('trayCount').textContent = '盘里有 ' + (7 + planted) + ' 颗';
  el('formula').textContent = '7 + ' + planted + ' = ' + (7 + planted);
  if (planted === 3) {
    el('plant').classList.add('hidden');
    el('nextTray').classList.remove('hidden');
    say('种满了。刚才的 3 个空格，现在都有了种子。');
  }
});
on('nextTray', () => {
  for (let i = 7; i <= 10; i++) {
    el('c' + i).classList.remove('new');
    el('c' + i).classList.remove('filled');
  }
  el('trayCount').textContent = '新盘里有 6 颗';
  el('formula').textContent = '6 + ? = 10';
  screen(2);
});
on('a3', () => say('从 6 往后数 3 下，再看一看有没有到 10。'));
on('a5', () => say('第二排已经种了 1 颗。你要数的是剩下的空格。'));
on('a4', () => {
  for (let i = 7; i <= 10; i++) el('c' + i).classList.add('new');
  el('trayCount').textContent = '两排都满了';
  el('formula').textContent = '6 + 4 = 10';
  screen(3);
});
reflection('种子盘：7 加 3 到 10；换成 6，要再种 4 颗。');
