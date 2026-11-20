import { BookOpen, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Dialog } from '../components/UI';
import { uiText } from '../i18n';
import { studyLessons, type StudyLesson } from './studyLessons';
import './StudyLessonShelf.css';

async function loadLesson(lesson: StudyLesson) {
  const [{ WebsiteProjectPreview }, { default: catalog }] = await Promise.all([
    import('../components/WebsiteProjectPreview'),
    import('../../../shared/skill-workflow-resources.json'),
  ]);
  const content = catalog['pep-math-practice'].files[`assets/${lesson.file}`];
  if (!content) throw new Error('Missing packaged lesson.');
  const files = [
    { path: lesson.file, mime: 'text/html', bytes: new TextEncoder().encode(content) },
  ];
  return { Preview: WebsiteProjectPreview, files };
}

function StudyLessonDialog({
  lesson,
  close,
  reflect,
}: {
  lesson: StudyLesson;
  close: () => void;
  reflect: (prompt: string, words?: string) => void;
}) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof loadLesson>> | 'failed'>();
  const returned = useRef(false);
  useEffect(() => {
    let current = true;
    void loadLesson(lesson).then(
      (result) => {
        if (current) setPreview(result);
      },
      () => {
        if (current) setPreview('failed');
      },
    );
    return () => {
      current = false;
    };
  }, [lesson]);
  function returnToChat(words?: string) {
    if (returned.current) return;
    returned.current = true;
    // Finish the dialog's focus restoration before moving the learner to the composer.
    flushSync(close);
    reflect(uiText(lesson.draft), words);
  }
  return (
    <Dialog
      title={uiText(lesson.label)}
      onClose={close}
      wide
      portal
      scrollBody={false}
      className="study-lesson-dialog"
    >
      <div className="study-lesson-content">
        {preview === 'failed' ? (
          <p role="alert">{uiText('workspace:studyLessonUnavailable')}</p>
        ) : preview ? (
          <preview.Preview
            files={preview.files}
            entryPath={lesson.file}
            onNavigate={() => {}}
            onStudyReflection={returnToChat}
          />
        ) : (
          <p role="status">{uiText('workspace:websiteLoading')}</p>
        )}
      </div>
      {preview && preview !== 'failed' && (
        <footer>
          <button type="button" className="primary-button" onClick={() => returnToChat()}>
            {uiText('workspace:studyReturn')}
          </button>
        </footer>
      )}
    </Dialog>
  );
}

export function StudyLessonShelf({
  reflect,
}: {
  reflect: (prompt: string, words?: string) => void;
}) {
  const [active, setActive] = useState<StudyLesson>();
  return (
    <section className="study-lesson-shelf" aria-label={uiText('workspace:studyPractice')}>
      <span>
        <BookOpen size={16} aria-hidden="true" />
        {uiText('workspace:studyPractice')}
      </span>
      {studyLessons.map((lesson) => (
        <button
          key={lesson.file}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setActive(lesson)}
        >
          {uiText(lesson.label)}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ))}
      {active && (
        <StudyLessonDialog
          key={active.file}
          lesson={active}
          close={() => setActive(undefined)}
          reflect={reflect}
        />
      )}
    </section>
  );
}
