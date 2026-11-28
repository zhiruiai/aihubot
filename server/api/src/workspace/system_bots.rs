use super::{
    Table, WorkspaceStore, access, groups, model, mutations, starter_bots, starter_skills, unread,
};
use crate::{
    db::State,
    error::{ApiError, Body, Result, only_fields},
};
use axum::{
    Json,
    extract::{Path, State as Extract},
    http::HeaderMap,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;
use std::sync::LazyLock;

const LEGACY_RECRUITER_BINDING: &str = "builtin-recruiter";
const RECRUITER: &str = "recruiter";
static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../shared/system-bots.json"))
        .expect("The checked-in system Bot catalog is valid JSON")
});
const PROFILE_FIELDS: [&str; 6] = [
    "name",
    "role",
    "description",
    "instructions",
    "avatar",
    "color",
];
// SHA-256 of the six exact profile fields in each released catalog.
const LEGACY_PROFILES: [(&str, &str); 4] = [
    // ca41ab8, before the dedicated recruiter entry.
    (
        "zh-CN",
        "aba904a9ce1a9650f9e0c3b0616be83e799fcb1661af651b877575e4a02dce7a",
    ),
    (
        "en",
        "22c33c62e910e8c747955c584f64f3c1256f05bcc2ed23a1e0b7222da6e1aff0",
    ),
    // b836a58 through the last BambooShift release.
    (
        "zh-CN",
        "86093cd6efe3a8f6f2efb2856201c0463fcb87203b8077bb2eb12e95758ad139",
    ),
    (
        "en",
        "e27ebe725d8f8c4bf1024ec750e4443b3cda6fba3067a714cd7397fe19413131",
    ),
];
struct SystemBot<'a> {
    id: &'a str,
    template: &'static Value,
}

impl<'a> SystemBot<'a> {
    fn get(id: &'a str) -> Result<Self> {
        let template = CATALOG
            .get(id)
            .filter(|entry| entry.is_object())
            .ok_or_else(|| {
                ApiError::new(404, "系统 Bot 不存在。").with_code("SYSTEM_BOT_NOT_FOUND")
            })?;
        Ok(Self { id, template })
    }

    fn binding(&self) -> String {
        if self.id == RECRUITER {
            LEGACY_RECRUITER_BINDING.into()
        } else {
            format!("builtin-system-bot:{}", self.id)
        }
    }

    fn profile(&self, locale: &str) -> Result<Value> {
        if let Some(text) = self.template["locales"].get(locale) {
            return Ok(json!({
                "name":text["name"],"role":text["role"],"description":text["description"],
                "instructions":text["instructions"],"avatar":self.template["avatar"],"color":self.template["color"]
            }));
        }
        self.template["starterId"]
            .as_str()
            .and_then(|id| starter_bots::profile(id, locale))
            .ok_or_else(|| ApiError::new(500, "系统 Bot 模板暂不可用。"))
    }

    async fn create(
        &self,
        store: &WorkspaceStore,
        conn: &mut SqliteConnection,
        locale: &str,
    ) -> Result<(Value, Value, bool)> {
        let profile = self.profile(locale)?;
        let packs = starter_skills::selected(&self.template["skills"], locale)?;
        let (mut agent, conversation) = mutations::create_bot(store, conn, &profile).await?;
        agent["systemBot"] = json!(self.id);
        WorkspaceStore::put_in(conn, Table::Agents, &agent).await?;
        starter_skills::install(conn, &packs, &agent["id"]).await?;
        Ok((agent, conversation, true))
    }
}

fn direct(chat: &Value, agent: &Value) -> bool {
    chat["isGroup"] == false && chat["agentIds"] == json!([agent["id"]])
}

enum TemplateMatch {
    Current,
    Previous(&'static str),
}

fn prior_template(agent: &Value, profiles: &[Value; 2]) -> Option<TemplateMatch> {
    if agent.get("sharedBot").is_some()
        || !agent["avatarImageId"].is_null()
        || (!agent["systemBot"].is_null() && agent["systemBot"] != RECRUITER)
    {
        return None;
    }
    let fields = PROFILE_FIELDS.map(|k| &agent[k]);
    if profiles
        .iter()
        .any(|profile| PROFILE_FIELDS.map(|k| &profile[k]) == fields)
    {
        return Some(TemplateMatch::Current);
    }
    // Exact shipped profiles can be upgraded without overwriting customized prompts.
    let encoded = serde_json::to_vec(&fields).ok()?;
    let digest = hex::encode(Sha256::digest(encoded));
    LEGACY_PROFILES
        .iter()
        .find_map(|(locale, old)| (*old == digest).then_some(TemplateMatch::Previous(locale)))
}

async fn find_or_create(
    store: &WorkspaceStore,
    conn: &mut SqliteConnection,
    role: &SystemBot<'_>,
    binding: &Value,
    locale: &str,
) -> Result<(Value, Value, bool)> {
    let agent = match binding["agentId"].as_str() {
        Some(id) => WorkspaceStore::get_in(conn, Table::Agents, id)
            .await?
            .filter(|agent| {
                mutations::local(agent).is_ok()
                    && (agent["systemBot"].is_null() || agent["systemBot"] == role.id)
            }),
        None => None,
    };
    let (agent, previous_locale) = if role.id == RECRUITER {
        match_recruiter(conn, role, agent).await?
    } else {
        (agent, None)
    };
    let Some(mut agent) = agent else {
        return role.create(store, conn, locale).await;
    };

    let remembered = match binding["conversationId"].as_str() {
        Some(id) => WorkspaceStore::get_in(conn, Table::Conversations, id)
            .await?
            .filter(|chat| direct(chat, &agent)),
        None => None,
    };
    let chat = match remembered {
        Some(chat) => Some(chat),
        None => WorkspaceStore::list_in(conn, Table::Conversations)
            .await?
            .into_iter()
            .find(|chat| direct(chat, &agent)),
    };
    let mut changed = false;
    let old_name = agent["name"].clone();
    if let Some(locale) = previous_locale {
        let updated = role.profile(locale)?;
        for key in PROFILE_FIELDS {
            agent[key] = updated[key].clone();
        }
        agent["configRevision"] = json!(uuid::Uuid::new_v4().to_string());
        changed = true;
    }
    if changed || agent["systemBot"] != role.id {
        agent["systemBot"] = json!(role.id);
        WorkspaceStore::put_in(conn, Table::Agents, &agent).await?;
        changed = true;
    }
    let chat = match chat {
        Some(mut chat) => {
            if chat["title"] == old_name && agent["name"] != old_name {
                chat["title"] = agent["name"].clone();
                WorkspaceStore::put_in(conn, Table::Conversations, &chat).await?;
            }
            chat
        }
        None => {
            changed = true;
            groups::create_direct(conn, &agent).await?
        }
    };
    Ok((agent, chat, changed))
}

async fn match_recruiter(
    conn: &mut SqliteConnection,
    role: &SystemBot<'_>,
    bound: Option<Value>,
) -> Result<(Option<Value>, Option<&'static str>)> {
    let profiles = [role.profile("zh-CN")?, role.profile("en")?];
    let previous = |matched| match matched {
        TemplateMatch::Current => None,
        TemplateMatch::Previous(locale) => Some(locale),
    };
    if let Some(agent) = bound {
        let locale = prior_template(&agent, &profiles).and_then(previous);
        return Ok((Some(agent), locale));
    }
    for agent in WorkspaceStore::list_in(conn, Table::Agents).await? {
        if let Some(matched) = prior_template(&agent, &profiles) {
            return Ok((Some(agent), previous(matched)));
        }
    }
    Ok((None, None))
}

fn public_fields(value: Value, fields: &[&str]) -> Value {
    let Value::Object(mut data) = value else {
        return Value::Null;
    };
    data.retain(|field, _| fields.contains(&field.as_str()));
    Value::Object(data)
}

pub async fn post(
    Extract(state): Extract<State>,
    Path((wid, id)): Path<(String, String)>,
    headers: HeaderMap,
    Body(body): Body,
) -> Result<Json<Value>> {
    open(&state, &wid, &id, &headers, &body, false).await
}

pub async fn recruiter(
    Extract(state): Extract<State>,
    Path(wid): Path<String>,
    headers: HeaderMap,
    Body(body): Body,
) -> Result<Json<Value>> {
    open(&state, &wid, RECRUITER, &headers, &body, true).await
}

async fn open(
    state: &State,
    wid: &str,
    id: &str,
    headers: &HeaderMap,
    body: &Value,
    legacy: bool,
) -> Result<Json<Value>> {
    let grant = access::require(state, headers, wid, true, true).await?;
    let role = SystemBot::get(id)?;
    only_fields(body, &["locale"])?;
    let locale = body["locale"]
        .as_str()
        .filter(|locale| matches!(*locale, "zh-CN" | "en"))
        .ok_or_else(|| {
            if legacy {
                ApiError::bad("招聘助理语言无效。").with_code("INVALID_RECRUITER_LOCALE")
            } else {
                ApiError::bad("系统 Bot 语言无效。").with_code("INVALID_SYSTEM_BOT_LOCALE")
            }
        })?;
    let store = grant.store(state).await?;
    let _credentials = store.credential_lock.lock().await;
    let mut tx = store.begin().await?;
    let binding_id = role.binding();
    let prior = WorkspaceStore::get_in(&mut tx, Table::Settings, &binding_id)
        .await?
        .unwrap_or_default();
    let (mut agent, mut conversation, changed) =
        find_or_create(&store, &mut tx, &role, &prior, locale).await?;
    let binding = json!({
        "id":binding_id,"agentId":agent["id"],"conversationId":conversation["id"]
    });
    if binding != prior {
        WorkspaceStore::put_in(&mut tx, Table::Settings, &binding).await?;
    }
    agent["modelConfigured"] = json!(
        model::bot_configured_in(&store, &mut tx, agent["id"].as_str().unwrap_or(""))
            .await
            .unwrap_or(false)
    );
    unread::project(
        &mut tx,
        &grant.user_id,
        std::slice::from_mut(&mut conversation),
    )
    .await?;
    grant.authorize(state).await?;
    tx.commit().await?;
    if changed {
        store.emit("update", json!({}));
    }
    grant.authorize(state).await?;
    let agent = public_fields(
        agent,
        &[
            "id",
            "name",
            "role",
            "description",
            "instructions",
            "avatar",
            "color",
            "avatarImageId",
            "modelProfileId",
            "modelConfigured",
            "status",
            "configRevision",
            "systemBot",
        ],
    );
    let conversation = public_fields(
        conversation,
        &[
            "id",
            "title",
            "agentIds",
            "isGroup",
            "updatedAt",
            "unread",
            "readThrough",
            "pinned",
        ],
    );
    Ok(Json(json!({
        "systemBot":role.id,"agentId":agent["id"],"conversationId":conversation["id"],"agent":agent,"conversation":conversation
    })))
}
