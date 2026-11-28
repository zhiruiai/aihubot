import test from 'node:test';
import assert from 'node:assert/strict';
import { KILO_FREE_PROFILE } from '../../shared/free-model';
import type { AppSettings, ModelProfile } from '../../shared/types';
import {
  all,
  component,
  configured,
  harness,
  json,
  profile,
  settings,
  text,
} from './fixtures/smartTeamSettingsFixture';

const changedEndpoint = 'https://replacement-model.example.test/v1';
const firstKey = 'synthetic-first-provider-key';
const replacementKey = 'synthetic-replacement-provider-key';

for (const mode of ['unconfigured', 'configured'] as const) {
  test(`the free trial saves without a key in a ${mode} workspace`, async () => {
    const editor = await modelEditor(mode);
    try {
      editor.ui
        .field('模型服务商')
        .props.onChange({ target: { value: KILO_FREE_PROFILE.provider } });
      await editor.ui.flush();
      assert.equal(all(editor.ui.tree, (node) => node.props.type === 'password').length, 0);
      assert.match(editor.ui.copy, /按 IP 限流/);
      await editor.save();
      assert.equal(editor.writes.length, 1);
      const { provider, model, baseUrl, activate } = editor.writes[0];
      assert.deepEqual({ provider, model, baseUrl }, KILO_FREE_PROFILE);
      assert.equal(activate, mode === 'unconfigured');
      assert.equal(Object.hasOwn(editor.writes[0], 'apiKey'), false);
      if (mode === 'configured') {
        assert.equal(Object.hasOwn(editor.writes[0], 'id'), false);
        assert.equal(editor.changes[0].profileId, configured.profileId);
      }
    } finally {
      editor.ui.dispose();
    }
  });
}

async function modelEditor(mode: 'configured' | 'unconfigured' | 'empty') {
  const writes: Record<string, unknown>[] = [];
  let selected = mode === 'configured' ? configured : settings;
  let profiles: ModelProfile[] =
    mode === 'configured'
      ? [profile]
      : mode === 'unconfigured'
        ? [
            {
              ...profile,
              ...settings,
              baseUrl: '',
              vision: false,
              id: settings.profileId,
              credentialSource: 'none',
            },
          ]
        : [];
  const changes: AppSettings[] = [];
  const ui = await harness(
    'web/src/components/SettingsDialog.tsx',
    'ModelSettingsDialog',
    {
      settings: selected,
      workspaceId: 'space-a',
      userId: 'owner-a',
      showManagement: false,
      onClose() {},
      onSettingsChanged(value: AppSettings) {
        changes.push(value);
      },
    },
    {
      window: { location: { pathname: '/w/space-a/' } },
      fetch: async (_url: unknown, init: RequestInit) => {
        if (init.method === 'GET')
          return json({
            activeProfileId: profiles.find(({ id }) => id === selected.profileId)?.id || '',
            profiles,
          });
        const body = JSON.parse(String(init.body));
        writes.push(body);
        const connected = Boolean(body.baseUrl || body.apiKey);
        const saved = {
          ...profile,
          id: body.id || 'new-model',
          name: body.name,
          baseUrl: body.baseUrl,
          configured: connected,
          hasApiKey: Boolean(body.apiKey),
          credentialSource: body.apiKey ? 'saved' : 'none',
        } as ModelProfile;
        profiles = [...profiles.filter(({ id }) => id !== saved.id), saved];
        if (body.activate || selected.profileId === saved.id)
          selected = {
            ...selected,
            profileId: saved.id,
            profileName: saved.name,
            configured: saved.configured,
            hasApiKey: saved.hasApiKey,
          };
        return json({ profile: saved, settings: selected });
      },
    },
  );
  await ui.flush();
  return {
    ui,
    writes,
    changes,
    async editInput(type: string, value: string) {
      const input = all(ui.tree, (node) => node.type === 'input' && node.props.type === type)[0];
      assert.ok(input, `Missing ${type} input`);
      input.props.onChange({ target: { value } });
      await ui.flush();
    },
    key() {
      return all(ui.tree, (node) => node.type === 'input' && node.props.type === 'password')[0]
        .props.value;
    },
    async save() {
      all(ui.tree, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
      await ui.flush();
    },
    canSubmit(label: string) {
      const form = all(ui.tree, (node) => node.type === 'form')[0];
      const footer = component(ui.tree, 'Dialog').props.footer;
      const button = all(
        footer,
        (node) => node.type === 'button' && text(node).trim() === label,
      )[0];
      assert.ok(button, `Missing footer button ${label}`);
      assert.equal(button.props.form, form.props.id);
      assert.equal(button.props.type, 'submit');
      return !button.props.disabled;
    },
  };
}

test('changing an existing model endpoint discards its unsaved key, including after switching back', async () => {
  const editor = await modelEditor('configured');
  try {
    await editor.editInput('password', firstKey);
    await editor.editInput('url', changedEndpoint);
    assert.equal(editor.key(), '');
    await editor.editInput('url', profile.baseUrl!);
    assert.equal(
      editor.key(),
      '',
      'Returning to the old address must not restore the old draft secret',
    );
    await editor.editInput('url', changedEndpoint);
    assert.equal(editor.writes.length, 0, 'Editing an endpoint must not send model requests');
    await editor.save();
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.writes[0].baseUrl, changedEndpoint);
    assert.equal(Object.hasOwn(editor.writes[0], 'apiKey'), false);
  } finally {
    editor.ui.dispose();
  }
});

test('a new model accepts a newly entered key for its changed endpoint and preserves it during name edits', async () => {
  const editor = await modelEditor('empty');
  try {
    await editor.editInput('password', firstKey);
    await editor.editInput('url', changedEndpoint);
    assert.equal(editor.key(), '');
    await editor.editInput('password', replacementKey);
    editor.ui
      .field('配置名称')
      .props.onChange({ target: { value: 'Synthetic replacement model' } });
    await editor.ui.flush();
    assert.equal(editor.key(), replacementKey);
    assert.equal(editor.writes.length, 0);
    await editor.save();
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.writes[0].baseUrl, changedEndpoint);
    assert.equal(editor.writes[0].apiKey, replacementKey);
    assert.equal(editor.writes[0].name, 'Synthetic replacement model');
    assert.equal(JSON.stringify(editor.writes).includes(firstKey), false);
  } finally {
    editor.ui.dispose();
  }
});

test('the first runnable profile can start chat with one atomic save', async () => {
  const editor = await modelEditor('unconfigured');
  try {
    assert.match(editor.ui.copy, /连接模型后开始对话/);
    editor.ui.button('添加').props.onClick();
    await editor.ui.flush();
    await editor.editInput('url', changedEndpoint);
    assert.equal(editor.canSubmit('保存并用于对话'), true);
    await editor.save();
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.writes[0].activate, true);
    assert.equal(editor.changes[0].profileId, 'new-model');
    assert.equal(editor.changes[0].configured, true);
    assert.match(editor.ui.copy, /已设为默认模型/);
  } finally {
    editor.ui.dispose();
  }
});

test('an incomplete first profile and a new secondary profile save without replacing the default', async () => {
  for (const mode of ['unconfigured', 'configured'] as const) {
    const editor = await modelEditor(mode);
    try {
      editor.ui.button('添加').props.onClick();
      await editor.ui.flush();
      if (mode === 'configured') await editor.editInput('url', changedEndpoint);
      assert.equal(editor.canSubmit('保存配置'), true);
      await editor.save();
      assert.equal(editor.writes.length, 1);
      assert.equal(editor.writes[0].activate, false);
      assert.equal(
        editor.changes[0].profileId,
        mode === 'configured' ? profile.id : settings.profileId,
      );
      assert.equal(editor.changes[0].configured, mode === 'configured');
    } finally {
      editor.ui.dispose();
    }
  }
});
