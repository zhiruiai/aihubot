import { useEffect, useMemo, useRef, useState } from 'react';
import { uiText } from '../i18n';
import { websitePreviewDocument, websitePreviewToken } from '../websitePreviewDocument';
import { websiteFiles, type WebsitePreviewFile } from '../websitePreviewFiles';
import './WebsiteProjectPreview.css';

export type { WebsitePreviewFile } from '../websitePreviewFiles';

export function WebsiteProjectPreview({
  files,
  entryPath,
  onNavigate,
  onSaveFile,
  onStudyReflection,
}: {
  files: WebsitePreviewFile[];
  entryPath: string;
  onNavigate(path: string): void;
  onSaveFile?: (path: string) => Promise<void>;
  onStudyReflection?: (words: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [requested, setRequested] = useState<{ channel: string; path: string }>();
  const scriptError = uiText('workspace:websiteProjectScriptError');
  const partial = uiText('workspace:websiteProjectPartial');
  const studyReturnLabel = onStudyReflection ? uiText('workspace:studyCarryAnswer') : undefined;
  const preview = useMemo(() => {
    try {
      const index = websiteFiles(files);
      const channel = websitePreviewToken();
      const desktopDownloads = onSaveFile ? new Set<string>() : undefined;
      const srcDoc = websitePreviewDocument(index, entryPath, {
        channel,
        scriptError,
        partial,
        desktopDownloads,
        studyReturnLabel,
      });
      return { index, channel, srcDoc, desktopDownloads };
    } catch {
      return undefined;
    }
  }, [files, entryPath, scriptError, partial, onSaveFile, studyReturnLabel]);

  useEffect(() => {
    if (!preview) return;
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        message?.channel !== preview.channel ||
        typeof message.value !== 'string'
      )
        return;
      if (message.kind === 'navigate' && preview.index.get(message.value)?.mime === 'text/html') {
        onNavigate(message.value);
      } else if (message.kind === 'download' && preview.desktopDownloads?.has(message.value)) {
        setRequested({ channel: preview.channel, path: message.value });
      } else if (
        message.kind === 'study-reflection' &&
        message.value.trim() &&
        message.value.length <= 180
      ) {
        onStudyReflection?.(message.value);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [preview, onNavigate, onStudyReflection]);

  return preview ? (
    <>
      {onSaveFile && requested?.channel === preview.channel && (
        <WebsiteFileSave
          key={requested.path}
          path={requested.path}
          onSave={onSaveFile}
          onClose={() => {
            setRequested((current) => (current === requested ? undefined : current));
            frame.current?.focus();
          }}
        />
      )}
      <iframe
        ref={frame}
        tabIndex={0}
        className="website-project-preview"
        title={uiText('workspace:filePreviewDocument')}
        sandbox={
          preview.desktopDownloads
            ? 'allow-scripts allow-pointer-lock'
            : 'allow-scripts allow-pointer-lock allow-downloads'
        }
        referrerPolicy="no-referrer"
        srcDoc={preview.srcDoc}
      />
    </>
  ) : (
    <p role="alert">{uiText('workspace:filePreviewError_type')}</p>
  );
}

function WebsiteFileSave({
  path,
  onSave,
  onClose,
}: {
  path: string;
  onSave: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'ready' | 'saving' | 'failed'>('ready');
  useEffect(() => {
    button.current?.focus();
  }, []);
  async function save() {
    if (state === 'saving') return;
    setState('saving');
    try {
      await onSave(path);
      onClose();
    } catch {
      setState('failed');
    }
  }
  return (
    <div className="website-file-save">
      <button
        className="primary-button"
        type="button"
        ref={button}
        onClick={() => void save()}
        disabled={state === 'saving'}
      >
        {uiText('workspace:websiteSaveFile', { name: path })}
      </button>
      <button
        className="secondary-button"
        type="button"
        onClick={onClose}
        disabled={state === 'saving'}
      >
        {uiText('common:text_2cd0f3be8738')}
      </button>
      {state === 'failed' && <span role="alert">{uiText('workspace:websiteSaveFileFailed')}</span>}
    </div>
  );
}
