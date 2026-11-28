import { AudioWaveform, ArrowUp, Loader2, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, fileBase64 } from '../api';
import { uiText } from '../i18n';
import {
  audioError,
  createAudioRecorder,
  SPEECH_RATE,
  SPEECH_SECONDS,
  type AudioRecorder,
} from '../speechAudio';
import { voiceMemoTime } from '../voiceMemo';
import type { createChatSendScope } from '../chatSendScope';
import { IconButton } from './UI';
import { stopVoicePlayback, VoicePlayback } from './VoiceMemoCard';
import './VoiceRecordingControls.css';

type Recording = { id: string; blob: Blob; durationMs: number };
type Capture =
  | { phase: 'starting' | 'finishing' }
  | { phase: 'recording'; ms: number }
  | { phase: 'ready' | 'sending'; recording: Recording; error?: string }
  | { phase: 'idle'; error?: string };

export function useVoiceRecording({
  identity,
  scope,
  sendScope,
  conversationId,
  threadRootId,
  allowed,
  stopReading,
  refresh,
}: {
  identity: string;
  scope: string;
  sendScope: ReturnType<typeof createChatSendScope>;
  conversationId: string;
  threadRootId?: string;
  allowed: boolean;
  stopReading: () => void;
  refresh: () => Promise<unknown>;
}) {
  const [state, setCapture] = useState<Capture>({ phase: 'idle' });
  const latest = useRef({ identity, allowed });
  latest.current = { identity, allowed };
  const recorder = useRef<AudioRecorder>(undefined);
  const delivery = useRef<string>(undefined);
  const live = useRef<string>(undefined);
  const current = () => live.current === identity && latest.current.identity === identity;
  const capture: Capture = current() ? state : { phase: 'idle' };

  useEffect(() => {
    live.current = identity;
    const stop = () => {
      recorder.current?.cancel();
      recorder.current = undefined;
      delivery.current = undefined;
      setCapture({ phase: 'idle' });
    };
    const onVisibility = () => {
      if (document.hidden && recorder.current) stop();
    };
    const events = [
      'pagehide',
      'openbot:account-expired',
      'openbot:unpaired',
      'openbot:revalidate',
    ];
    events.forEach((event) => window.addEventListener(event, stop));
    document.addEventListener('visibilitychange', onVisibility);
    setCapture({ phase: 'idle' });
    return () => {
      live.current = undefined;
      recorder.current?.cancel();
      recorder.current = undefined;
      delivery.current = undefined;
      events.forEach((event) => window.removeEventListener(event, stop));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [identity]);

  useEffect(() => {
    if (!allowed && recorder.current) {
      recorder.current.cancel();
      recorder.current = undefined;
      setCapture({ phase: 'idle' });
    }
  }, [allowed]);

  async function finish() {
    const active = recorder.current;
    if (!active || !current()) return;
    setCapture({ phase: 'finishing' });
    try {
      const blob = await active.finish();
      if (active !== recorder.current || !current()) return;
      const durationMs = Math.floor((blob.size - 44) / ((SPEECH_RATE * 2) / 1000));
      setCapture(
        durationMs < 250
          ? { phase: 'idle', error: uiText('workspace:voiceRecordingShort') }
          : { phase: 'ready', recording: { id: crypto.randomUUID(), blob, durationMs } },
      );
    } catch (error) {
      if (active === recorder.current && current())
        setCapture({ phase: 'idle', error: audioError(error) });
    } finally {
      if (active === recorder.current) recorder.current = undefined;
    }
  }

  function start() {
    if (!current() || !latest.current.allowed || recorder.current || delivery.current) return;
    stopReading();
    stopVoicePlayback(scope);
    const active = createAudioRecorder({
      onTime: (ms) => {
        if (active === recorder.current && current())
          setCapture((state) => (state.phase === 'recording' ? { phase: 'recording', ms } : state));
      },
      onLimit: () => {
        if (active === recorder.current && current()) void finish();
      },
      onError: (error) => {
        if (active !== recorder.current || !current()) return;
        active.cancel();
        recorder.current = undefined;
        setCapture({ phase: 'idle', error: audioError(error) });
      },
    });
    recorder.current = active;
    setCapture({ phase: 'starting' });
    void active.start().then(
      () => {
        if (active === recorder.current && current()) setCapture({ phase: 'recording', ms: 0 });
      },
      (error) => {
        if (active !== recorder.current || !current()) return;
        recorder.current = undefined;
        setCapture({ phase: 'idle', error: audioError(error) });
      },
    );
  }

  function discard() {
    if (delivery.current) return;
    recorder.current?.cancel();
    recorder.current = undefined;
    setCapture({ phase: 'idle' });
  }

  async function send(recording: Recording) {
    if (!current() || !latest.current.allowed || delivery.current) return;
    const ticket = sendScope.ticket();
    if (!sendScope.current(ticket)) return;
    const valid = () => current() && delivery.current === recording.id && sendScope.current(ticket);
    delivery.current = recording.id;
    setCapture({ phase: 'sending', recording });
    try {
      const name = `recording-${recording.id}.wav`;
      const content = await fileBase64(new File([recording.blob], name, { type: 'audio/wav' }));
      if (!valid()) return;
      await sendScope.request('/files', 'POST', {
        name,
        type: 'audio/wav',
        content,
        conversationId,
        voiceRecordingId: recording.id,
        ...(threadRootId ? { threadRootId } : {}),
      });
      if (!valid()) return;
      setCapture({ phase: 'idle' });
      void refresh().catch(() => {});
    } catch (error) {
      if (valid())
        setCapture({
          phase: 'ready',
          recording,
          error:
            error instanceof ApiError && error.status >= 400 && error.status < 500
              ? error.message
              : uiText('workspace:voiceRecordingRetry'),
        });
    } finally {
      if (delivery.current === recording.id) delivery.current = undefined;
    }
  }

  const pending = capture.phase !== 'idle';
  const loading = capture.phase === 'starting' || capture.phase === 'finishing';
  const durationMs = capture.phase === 'recording' ? capture.ms : undefined;
  const recording = 'recording' in capture ? capture.recording : undefined;
  const sending = capture.phase === 'sending';
  const error = 'error' in capture ? capture.error : undefined;
  const info =
    capture.phase === 'starting'
      ? uiText('workspace:voiceRecordingStarting')
      : capture.phase === 'finishing'
        ? uiText('workspace:voiceRecordingPreparing')
        : uiText('workspace:voiceRecordingInProgress');

  return {
    pending,
    startButton: (
      <IconButton
        label={uiText('workspace:voiceRecordingStart')}
        className="composer-voice-recording"
        disabled={!allowed || pending}
        onClick={start}
      >
        <AudioWaveform size={17} aria-hidden="true" />
      </IconButton>
    ),
    panel: (pending || error) && (
      <div
        className="composer-recording-panel"
        aria-label={uiText('workspace:voiceRecordingTitle')}
      >
        {pending && (
          <div className="composer-recording-controls">
            {recording ? (
              <div className="composer-recording-preview">
                <VoicePlayback
                  key={recording.id}
                  recording
                  durationMs={recording.durationMs}
                  scope={scope}
                  pathname={window.location.pathname}
                  current={current}
                  blocked={!allowed || sending}
                  stopReading={stopReading}
                  loadAudio={async () => recording.blob}
                />
              </div>
            ) : (
              <div className="composer-recording-status">
                {loading ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <span className="composer-recording-dot" aria-hidden="true" />
                )}
                <span role="status">{info}</span>
                {durationMs !== undefined && (
                  <span className="voice-memo-time">
                    {voiceMemoTime(durationMs / 1000)} / {voiceMemoTime(SPEECH_SECONDS)}
                  </span>
                )}
              </div>
            )}
            <div className="composer-recording-actions">
              <IconButton
                label={uiText('workspace:voiceRecordingDiscard')}
                disabled={sending}
                onClick={discard}
              >
                <X size={16} aria-hidden="true" />
              </IconButton>
              {recording ? (
                <button
                  type="button"
                  className="composer-recording-send"
                  aria-label={uiText('workspace:voiceRecordingSend')}
                  disabled={!allowed || sending}
                  onClick={() => void send(recording)}
                >
                  {sending ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <ArrowUp size={17} aria-hidden="true" />
                  )}
                  <span>
                    {uiText(
                      sending ? 'workspace:voiceRecordingSending' : 'workspace:voiceRecordingSend',
                    )}
                  </span>
                </button>
              ) : (
                <IconButton
                  label={uiText('workspace:voiceRecordingFinish')}
                  className="composer-recording-stop"
                  disabled={capture.phase !== 'recording'}
                  onClick={() => void finish()}
                >
                  <Square size={13} fill="currentColor" aria-hidden="true" />
                </IconButton>
              )}
            </div>
          </div>
        )}
        {error && (
          <p className="voice-recording-error" role="status">
            {error}
            {!pending && (
              <IconButton label={uiText('workspace:voiceRecordingDiscard')} onClick={discard}>
                <X size={15} aria-hidden="true" />
              </IconButton>
            )}
          </p>
        )}
      </div>
    ),
  };
}
