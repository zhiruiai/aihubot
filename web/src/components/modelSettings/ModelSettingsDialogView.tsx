import { uiText } from '../../i18n';
import { Check, Copy, LayoutGrid, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useId } from 'react';
import { KILO_FREE_PROFILE } from '../../../../shared/free-model';
import { workspaceUrl } from '../../workspace-scope';
import '../SettingsDialog.css';
import { Dialog, IconButton } from '../UI';
import {
  credentialLabel,
  credentialPlaceholder,
  freeModelDraft,
  NEW_PROFILE,
  newProfile,
  providers,
} from './parts';
import type { useModelSettingsDialog } from './useModelSettingsDialog';
export type ModelSettingsDialogModel = ReturnType<typeof useModelSettingsDialog>;
export function ModelSettingsDialogView(model: ModelSettingsDialogModel) {
  const formId = useId();
  const {
    visible,
    pendingRef,
    scope,
    onClose,
    active,
    settings,
    setupRequired,
    useOnSave,
    locked,
    loadProfiles,
    add,
    loading,
    list,
    selected,
    choose,
    drafts,
    isDefault,
    profile,
    dirty,
    activate,
    pending,
    error,
    notice,
    feedbackRef,
    draft,
    save,
    nameRef,
    edit,
    endpointChanged,
    resetDraft,
    showManagement,
    closeLabel,
  } = model;
  const canCopy = !!profile && (profile.configured || !setupRequired);
  const free = draft?.provider === KILO_FREE_PROFILE.provider;
  return (
    <Dialog
      active={visible}
      title={uiText('settings:text_c27d63b467b6')}
      subtitle={setupRequired ? undefined : uiText('settings:text_b211453ffceb')}
      className="model-preferences-dialog"
      onClose={() => {
        if (!pendingRef.current && scope.current(scope.ticket())) onClose();
      }}
      footer={
        <div className="dialog-actions">
          {showManagement && !/\/manage\/?$/.test(window.location.pathname) && (
            <a className="secondary-button model-admin-link" href={workspaceUrl('/manage')}>
              <LayoutGrid size={14} />
              {uiText('settings:text_c6bdf6d83d2c')}
            </a>
          )}
          <button
            className="secondary-button"
            type="button"
            disabled={pending !== null}
            onClick={() => {
              if (!pendingRef.current && scope.current(scope.ticket())) onClose();
            }}
          >
            {closeLabel || uiText('settings:text_c0b3fbff51cc')}
          </button>
          {draft && (
            <button
              className="primary-button"
              type="submit"
              form={formId}
              disabled={locked || !dirty}
            >
              {pending === 'save' ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
              {useOnSave
                ? uiText('settings:modelSetupSaveAndUse')
                : uiText('settings:text_6e584e3d5ce6')}
            </button>
          )}
        </div>
      }
    >
      <section className="model-settings" aria-label={uiText('settings:text_8cbcf741e727')}>
        <div className="model-current">
          {setupRequired ? (
            <>
              <strong>{uiText('settings:modelSetupTitle')}</strong>
              <span>{uiText('settings:modelSetupHelp')}</span>
            </>
          ) : (
            <>
              <span className="model-current-label">{uiText('settings:text_f50585ee7631')}</span>
              <strong>{active?.name || settings.profileName || settings.model}</strong>
              <span>{active?.model || settings.model}</span>
            </>
          )}
        </div>
        <div className="model-profile-heading">
          <h3>{uiText('settings:text_9cea0da8e2a1')}</h3>
          <div>
            <IconButton
              label={uiText('settings:text_391b57598b85')}
              disabled={locked}
              onClick={() => void loadProfiles()}
            >
              <RefreshCw size={15} />
            </IconButton>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => add()}
            >
              <Plus size={14} />
              {uiText('settings:text_7a8a11ead507')}
            </button>
          </div>
        </div>
        {loading && !list && (
          <p className="model-loading">
            <Loader2 className="spin" size={15} />
            {uiText('settings:text_8a044dd74276')}
          </p>
        )}
        {list && (
          <div className="dialog-form model-profile-choice">
            <label>
              <span className="sr-only">{uiText('settings:text_315a8591eef2')}</span>
              <select
                value={selected}
                disabled={locked}
                onChange={(event) => choose(event.target.value)}
              >
                {list.profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.id === list.activeProfileId && item.configured
                      ? uiText('settings:text_5c4e00cd2f4c')
                      : ''}
                  </option>
                ))}
                {drafts[NEW_PROFILE] && (
                  <option value={NEW_PROFILE}>{uiText('settings:text_a95e6590e7c5')}</option>
                )}
              </select>
            </label>
            {!setupRequired && (
              <small className="field-help">{uiText('settings:text_0b8f4c946611')}</small>
            )}
            {(!setupRequired || (!isDefault && profile?.configured)) && (
              <div className="model-default-row">
                <span>
                  {isDefault
                    ? uiText('settings:text_d0e4121d563d')
                    : profile
                      ? profile.configured
                        ? uiText('settings:text_2b7228fa8ad5')
                        : uiText('settings:botModelNotConfigured')
                      : uiText('settings:text_853877119dd1')}
                </span>
                {isDefault && !setupRequired && (
                  <span className="model-default-badge">
                    <Check size={13} />
                    {uiText('settings:text_844b8cc8dff7')}
                  </span>
                )}
                {!isDefault && profile && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={locked || !profile.configured || dirty}
                    onClick={() => void activate()}
                  >
                    {pending === 'activate' && <Loader2 className="spin" size={14} />}
                    {uiText('settings:text_357211096f78')}
                  </button>
                )}
              </div>
            )}
            {profile && !isDefault && dirty && (
              <small className="field-help">{uiText('settings:text_e041baf76b36')}</small>
            )}
          </div>
        )}
        {(error || notice) && (
          <div ref={feedbackRef}>
            {error && (
              <div className="model-feedback error-text" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <p className="model-feedback model-success" role="status">
                {notice}
              </p>
            )}
          </div>
        )}
        {draft && (
          <form
            id={formId}
            className="dialog-form model-profile-form"
            onSubmit={(event) => void save(event)}
          >
            {(!setupRequired || dirty) && (
              <div className="model-editor-heading">
                <span>
                  {free
                    ? uiText('settings:modelFreeNoKey')
                    : profile
                      ? credentialLabel(profile)
                      : uiText('settings:text_431fd3179d73')}
                </span>
                {dirty && (
                  <span className="model-unsaved">{uiText('settings:text_6a1be012c99c')}</span>
                )}
              </div>
            )}
            <label>
              {uiText('settings:text_9919db867bd4')}
              <input
                ref={nameRef}
                value={draft.name}
                required
                maxLength={80}
                disabled={locked}
                placeholder={uiText('settings:text_14a76d1fa9b8')}
                onChange={(event) => edit({ name: event.target.value })}
              />
            </label>
            <label>
              {uiText('settings:text_e0e987445174')}
              <select
                value={draft.provider}
                disabled={locked}
                onChange={(event) => {
                  const provider = event.target.value;
                  if (provider === KILO_FREE_PROFILE.provider) {
                    if (profile?.configured) add('free');
                    else edit(freeModelDraft());
                    return;
                  }
                  const preset = provider === 'deepseek' ? newProfile() : null;
                  edit({
                    provider,
                    model: preset?.model || '',
                    baseUrl: '',
                    vision: false,
                    apiKey: '',
                    ...(free || (!profile && draft.name === 'DeepSeek Flash' && !preset)
                      ? { name: preset?.name || '' }
                      : {}),
                  });
                }}
              >
                {!providers.some(([value]) => value === draft.provider) && (
                  <option value={draft.provider}>{draft.provider}</option>
                )}
                {providers.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {free ? (
              <p className="field-help">
                {uiText('settings:modelFreeHelp')}{' '}
                <a
                  href="https://kilo.ai/docs/gateway/models-and-providers#kilo-autofree"
                  target="_blank"
                  rel="noreferrer"
                >
                  {uiText('settings:modelFreeTerms')}
                </a>
              </p>
            ) : (
              <>
                <label>
                  {uiText('settings:text_8b84338de394')}
                  <input
                    value={draft.model}
                    required
                    maxLength={200}
                    disabled={locked}
                    onChange={(event) => edit({ model: event.target.value })}
                    placeholder={uiText('settings:text_25030e2fdf5f')}
                  />
                  <small>
                    {draft.provider === 'deepseek' && draft.model === 'deepseek-flash'
                      ? uiText('settings:text_546d7151679c')
                      : uiText('settings:text_864f3e380bfa')}
                  </small>
                </label>
                <label>
                  {uiText('settings:text_5b439c874448')}
                  <input
                    type="url"
                    value={draft.baseUrl}
                    disabled={locked}
                    onChange={(event) => edit({ baseUrl: event.target.value, apiKey: '' })}
                    placeholder={uiText('settings:text_75f9d0fc8366')}
                  />
                  <small>{uiText('settings:text_71c716b74f60')}</small>
                </label>
                {!!draft.baseUrl.trim() && (
                  <label className="vision-setting">
                    <input
                      type="checkbox"
                      checked={draft.vision}
                      disabled={locked}
                      onChange={(event) => edit({ vision: event.target.checked })}
                    />
                    <span>
                      {uiText('settings:text_db7a997c74d3')}
                      <small>{uiText('settings:text_0077d43d4a8d')}</small>
                    </span>
                  </label>
                )}
                <label className="model-credential-field">
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={draft.apiKey}
                    disabled={locked}
                    onChange={(event) => edit({ apiKey: event.target.value })}
                    placeholder={credentialPlaceholder(endpointChanged ? undefined : profile)}
                  />
                  <small>
                    {endpointChanged
                      ? uiText('settings:text_9da91853791e')
                      : uiText('settings:text_1bc385c316eb')}
                  </small>
                </label>
              </>
            )}
            {profile && (canCopy || dirty) && (
              <div className="model-draft-actions">
                {canCopy && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={locked}
                    onClick={() => add('copy')}
                  >
                    <Copy size={14} />
                    {uiText('settings:text_4118a62f4371')}
                  </button>
                )}
                {dirty && (
                  <button
                    type="button"
                    className="model-reset"
                    disabled={locked}
                    onClick={resetDraft}
                  >
                    {uiText('settings:text_ddde08946298')}
                  </button>
                )}
              </div>
            )}
          </form>
        )}
        {error && !list && (
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void loadProfiles()}
          >
            {uiText('settings:text_5d3bf702b137')}
          </button>
        )}
        <p className="model-settings-note">{uiText('settings:text_0514eee587cf')}</p>
      </section>
    </Dialog>
  );
}
