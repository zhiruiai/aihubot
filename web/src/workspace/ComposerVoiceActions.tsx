import type { ReactNode } from 'react';
import { DictationButton } from '../components/DictationControls';
import { VoiceCallStart } from '../components/VoiceCallControls';
import { VoiceControls } from '../components/VoiceControls';
import { VoiceMemoRequest } from '../components/VoiceMemoRequest';
import type { WorkspaceVoiceCall } from '../useVoiceCall';
import type { WorkspaceModel } from './types';

export function ComposerVoiceActionsView({
  selected,
  dictation,
  voice,
  voiceCall,
  dictationDisabled,
  toggleDictation,
  recordingButton,
  recordingPending,
  memo,
  readKey,
}: Pick<WorkspaceModel, 'selected' | 'dictation' | 'voice' | 'toggleDictation'> & {
  voiceCall?: WorkspaceVoiceCall;
  dictationDisabled: boolean;
  recordingButton?: ReactNode;
  recordingPending?: boolean;
  memo?: { requested: boolean; disabled: boolean; toggle: () => void };
  readKey?: string;
}) {
  return (
    <>
      <DictationButton
        state={dictation.state}
        disabled={dictationDisabled || recordingPending || !!voiceCall?.active}
        onToggle={() => {
          voice.stopReading();
          toggleDictation();
        }}
      />
      {recordingButton}
      {voiceCall && (
        <VoiceCallStart
          key={selected}
          call={{ ...voiceCall, canStart: voiceCall.canStart && !recordingPending }}
        />
      )}
      {memo && (
        <VoiceMemoRequest active={memo.requested} disabled={memo.disabled} onChange={memo.toggle} />
      )}
      {readKey !== undefined && !voiceCall?.active && (
        <VoiceControls
          key={readKey}
          voice={voice}
          blocked={dictation.busy || recordingPending === true}
          onStop={() => {
            voice.stop();
            dictation.cancel();
          }}
        />
      )}
    </>
  );
}
