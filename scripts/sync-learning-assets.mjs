import { readFile, writeFile } from 'node:fs/promises';

const file = (path) => new URL('../' + path, import.meta.url);
const source =
  'https://github.com/jamesrochabrun/skills/tree/2482c176372299c92af01f8414a67172f324e8db/skills/math-teacher';
const lessons = ['ten-frame', 'equation-balance'];
const example = (name) => readFile(file('examples/education/' + name), 'utf8');
const sharedCss = await example('lesson.css');
async function lesson(slug) {
  const [template, css, js] = await Promise.all(
    ['html', 'css', 'js'].map((extension) => example(slug + '.' + extension)),
  );
  const links =
    '<link rel="stylesheet" href="./lesson.css" />\n' +
    '    <link rel="stylesheet" href="./' +
    slug +
    '.css" />';
  const script = '<script src="./' + slug + '.js"></script>';
  if (!template.includes(links) || !template.includes(script)) {
    throw Error('Missing local lesson asset links.');
  }
  return [
    'assets/' + slug + '.html',
    template
      .replace(links, () => '<style>\n' + sharedCss + css + '    </style>')
      .replace(script, () => '<script>\n' + js + '    </script>'),
  ];
}
const instructions = {
  'zh-CN':
    '先看[本课提示](references/lesson-notes.md)和[课程索引](references/curriculum.md)。内置课程从聊天直接打开，一年级用[十格种子](assets/ten-frame.html)，七年级用[等式天平](assets/equation-balance.html)。学生提交自己的答案和解释后，仅点评写出来的一步。照[复习卡](assets/review-card.md)记下题目、学生原话、核对或纠错和下次练习。题目由页面提供，作答来自学生发回的消息。不要推断学生在网页内的操作、作答方式和掌握程度。教学方法参考随包附有[MIT 许可](LICENSE-MATH-TEACHER.txt)的 math-teacher。',
  en: 'Read the [lesson cues](references/lesson-notes.md) and [curriculum](references/curriculum.md). The classroom opens the reviewed activity directly. Grade 1 uses the [ten-frame](assets/ten-frame.html) and Grade 7 uses the [balance](assets/equation-balance.html). After the learner sends their own answer and explanation, respond to the submitted step only. Use the [review card](assets/review-card.md) for the problem, learner response, check or correction, and next practice. The page supplied the problem; the learner supplied their answer. Do not infer in-page attempts, guessing or mastery. See the bundled [MIT notice](LICENSE-MATH-TEACHER.txt) for math-teacher.',
};

const [sharedUrl, mobileUrl] = [
  file('shared/skill-workflow-resources.json'),
  file('mobile/assets/skills/workflow-resources.json'),
];
const shared = await readFile(sharedUrl, 'utf8');
const mobile = await readFile(mobileUrl, 'utf8');
const catalog = JSON.parse(shared);
catalog['pep-math-practice'] = {
  source,
  license: 'MIT',
  instruction: instructions,
  files: {
    ...Object.fromEntries(await Promise.all(lessons.map(lesson))),
    'references/curriculum.md': await example('curriculum.md'),
    'references/lesson-notes.md': await example('lesson-notes.md'),
    'assets/review-card.md': await example('review-card.md'),
    'LICENSE-MATH-TEACHER.txt': await example('MATH-TEACHER-LICENSE.txt'),
  },
};
const rendered = JSON.stringify(catalog, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (shared !== rendered || mobile !== rendered) {
    throw Error('Run node scripts/sync-learning-assets.mjs after editing a learning asset.');
  }
} else {
  await writeFile(sharedUrl, rendered);
  await writeFile(mobileUrl, rendered);
}
