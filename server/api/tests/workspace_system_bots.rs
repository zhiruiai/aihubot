mod agent_delegation_support;
mod workspace_support;

use agent_delegation_support::{Group, Model, call, finish};
use base64::{Engine, engine::general_purpose::STANDARD};
use openbot_backend::workspace::Table;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};
use workspace_support::Fixture;

const ROLES: [(&str, &str); 4] = [
    ("recruiter", "bot-design"),
    ("skill-finder", "skill-discovery"),
    ("skill-creator", "skill-creation"),
    ("connector-builder", "connector-development"),
];

async fn open(f: &Fixture, id: &str, locale: &str) -> Value {
    let (status, body) = f
        .request(
            "POST",
            &f.path(&format!("/system-bots/{id}")),
            Some(json!({"locale":locale})),
            false,
            Some(&f.owner),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["systemBot"], id);
    assert_eq!(body["agent"]["systemBot"], id);
    assert_eq!(body["agentId"], body["agent"]["id"]);
    assert_eq!(body["conversationId"], body["conversation"]["id"]);
    assert_eq!(body["conversation"]["agentIds"], json!([body["agentId"]]));
    assert_eq!(body["conversation"]["isGroup"], false);
    assert!(body["agent"].get("apiKey").is_none());
    body
}

#[tokio::test]
async fn each_role_has_one_persistent_local_bot_chat_and_reviewed_package() {
    let f = Fixture::new().await;
    let before = f.bootstrap().await;
    let store = f
        .state
        .workspace
        .get(&f.workspace, &f.workspace)
        .await
        .unwrap();
    let mut agents = HashSet::new();
    let mut chats = HashSet::new();
    let mut events = store.subscribe();
    for (id, package) in ROLES {
        let (first, second) = tokio::join!(open(&f, id, "zh-CN"), open(&f, id, "zh-CN"));
        assert_eq!(first, second);
        assert_eq!(open(&f, id, "en").await, first);
        assert!(agents.insert(first["agentId"].as_str().unwrap().to_owned()));
        assert!(chats.insert(first["conversationId"].as_str().unwrap().to_owned()));
        let skills: Vec<_> = store
            .list(Table::Skills)
            .await
            .unwrap()
            .into_iter()
            .filter(|skill| skill["agentId"] == first["agentId"])
            .collect();
        assert_eq!(skills.len(), 5);
        let specialty = skills.iter().find(|s| s["name"] == package).unwrap();
        assert_eq!(specialty["status"], "active");
        assert_eq!(specialty["skillPackage"]["root"], package);
        assert_eq!(specialty["skillPackage"]["files"][0]["path"], "SKILL.md");
        assert!(specialty["skillPackage"]["files"].as_array().unwrap().len() > 1);
        assert_eq!(events.try_recv().unwrap().event, "update");
        assert!(events.try_recv().is_err());
    }
    let recruiter = open(&f, "recruiter", "en").await;
    let (status, compatible) = f
        .request(
            "POST",
            &f.path("/recruiter"),
            Some(json!({"locale":"en"})),
            false,
            Some(&f.owner),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(compatible, recruiter);
    let after = f.bootstrap().await;
    assert_eq!(
        after["agents"].as_array().unwrap().len(),
        before["agents"].as_array().unwrap().len() + 4
    );
    for key in ["messages", "apps", "settings", "routines"] {
        assert_eq!(after[key], before[key], "{key}");
    }
    for (id, request, member, actor, expected) in [
        (
            "skill-creator",
            json!({"locale":"en"}),
            true,
            f.member.as_str(),
            403,
        ),
        (
            "skill-finder",
            json!({"locale":"en","agentId":"spoofed"}),
            false,
            f.owner.as_str(),
            400,
        ),
        (
            "arbitrary-bot",
            json!({"locale":"en"}),
            false,
            f.owner.as_str(),
            404,
        ),
    ] {
        let (status, body) = f
            .request(
                "POST",
                &f.path(&format!("/system-bots/{id}")),
                Some(request),
                member,
                Some(actor),
            )
            .await;
        assert_eq!(status, expected, "{body}");
    }
    assert_eq!(f.bootstrap().await["agents"], after["agents"]);
    f.close().await;
}

fn tool_results(body: &Value) -> Vec<Value> {
    body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "tool")
        .map(|m| serde_json::from_str(m["content"].as_str().unwrap()).unwrap())
        .collect()
}

#[tokio::test]
async fn system_bot_chats_use_existing_tools_and_leave_drafts_for_review() {
    let f = Fixture::new().await;
    let store = f
        .state
        .workspace
        .get(&f.workspace, &f.workspace)
        .await
        .unwrap();
    let mut group = Group {
        f,
        store,
        cid: String::new(),
        ids: Vec::new(),
    };
    for (role, _) in ROLES {
        let opened = open(&group.f, role, "en").await;
        group.cid = opened["conversationId"].as_str().unwrap().to_owned();
        group.ids = vec![opened["agentId"].as_str().unwrap().to_owned()];
        let model = Model::new(Arc::new(move |body| Box::pin(async move {
            let results = tool_results(&body);
            let tool = match (role, results.len()) {
                ("recruiter", 0) => call("propose_bot", json!({"name":"Inventory Reviewer",
                    "role":"Check supplier lead times","description":"Review incoming order risks",
                    "instructions":"Verify dates and report open risks.","avatar":"arch","color":"#7459d0"})),
                ("skill-finder", 0) => call("find_skills", json!({"language":"en","query":"data-quality-review"})),
                ("skill-creator", 0) => call("propose_skill", json!({"name":"weekly-report-review",
                    "description":"Check the owner, date and open items of a weekly report.",
                    "content":"Use when a human submits a Markdown weekly report. Inspect its responsible owner, dates and open items, and return the completed checklist.",
                    "files":[{"path":"references/checklist.md","content":"- [ ] Owner\n- [ ] Date\n- [ ] Open items\n"}]})),
                ("connector-builder", 0) => call("list_app_providers", json!({"query":"notion"})),
                ("connector-builder", 1) => {
                    assert_eq!(results[0]["providers"][0]["providerId"], "notion");
                    assert_eq!(results[0]["providers"][0]["connectionStatus"], "not_connected");
                    call("suggest_app_connection", json!({"providerId":"notion","reason":"Read only reviewed project pages."}))
                }
                ("skill-finder", 1) => {
                    assert_eq!(results[0]["items"][0]["id"], "data-quality-review");
                    assert_eq!(results[0]["items"][0]["status"], "available");
                    assert_eq!(results[0]["items"][0]["files"][0], "SKILL.md");
                    finish("Found a reviewed data quality package.")
                }
                ("skill-creator", 1) => {
                    assert_eq!(results[0]["status"], "proposed");
                    assert_eq!(results[0]["review"]["skillId"], results[0]["id"]);
                    finish("The generated package is ready for review.")
                }
                _ => finish("The proposal is ready for owner review."),
            };
            tool
        }))).await;
        group.configure(&model).await;
        group
            .send(
                "Complete this disposable approval or lookup request.",
                "followUp",
                false,
            )
            .await;
        let messages = group.done().await;
        assert!(
            messages
                .iter()
                .any(|m| m["status"] == "done" && m["role"] == "assistant"),
            "{messages:?}"
        );
        match role {
            "recruiter" => assert!(messages.iter().any(|m| m["kind"] == "creation_preview"
                && m["metadata"]["creationPreview"]["profile"]["name"] == "Inventory Reviewer")),
            "skill-finder" => {
                assert!(
                    messages
                        .iter()
                        .any(|m| m["content"] == "Found a reviewed data quality package.")
                );
                let card = messages
                    .iter()
                    .find(|m| m["kind"] == "skill_results")
                    .unwrap();
                assert_eq!(
                    card["metadata"]["skillResults"],
                    json!({
                        "agentId":group.ids[0],"skillIds":["data-quality-review"]
                    })
                );
            }
            "skill-creator" => {
                let card = messages
                    .iter()
                    .find(|m| m["kind"] == "skill_proposal")
                    .unwrap();
                let receipt = &card["metadata"]["skillProposal"];
                assert_eq!(receipt["kind"], "authored");
                assert_eq!(receipt["agentId"], group.ids[0]);
                assert_eq!(receipt["version"], 1);
                let id = receipt["skillId"].as_str().unwrap();
                let skill = group.store.get(Table::Skills, id).await.unwrap().unwrap();
                assert_eq!(skill["name"], "weekly-report-review");
                assert_eq!(skill["status"], "proposed");
                assert!(skill["approvedAt"].is_null());
                let bytes: Vec<u8> = sqlx::query_scalar("SELECT content FROM skill_package_files WHERE skill_id=? AND path='references/checklist.md'")
                    .bind(id).fetch_one(&group.store.pool).await.unwrap();
                assert_eq!(bytes, b"- [ ] Owner\n- [ ] Date\n- [ ] Open items\n");
                verify_skill_handoff(&group, &skill, &bytes).await;
            }
            _ => assert!(
                messages
                    .iter()
                    .any(|m| m["metadata"]["appConnectionProposal"]["providerId"] == "notion")
            ),
        }
    }
    let final_state = group.f.bootstrap().await;
    assert!(final_state["apps"].as_array().unwrap().is_empty());
    assert_eq!(
        final_state["agents"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|agent| agent["systemBot"].is_string())
            .count(),
        4
    );
    group.close().await;
}

async fn verify_skill_handoff(group: &Group, skill: &Value, bytes: &[u8]) {
    let id = skill["id"].as_str().unwrap();
    let path = group.f.path(&format!("/skills/{id}/review-package"));
    let (status, denied) = group
        .f
        .request("GET", &path, None, true, Some(&group.f.member))
        .await;
    assert_eq!(status, 403, "{denied}");
    let (status, mut package) = group
        .f
        .request("GET", &path, None, false, Some(&group.f.owner))
        .await;
    assert_eq!(status, 200, "{package}");
    assert_eq!(package["name"], skill["name"]);
    assert_eq!(
        package["skillPackage"]["frontmatter"]["metadata"]["created-with"],
        "aihubot"
    );
    assert!(package["skillPackage"]["frontmatter"].get("name").is_none());
    assert!(
        package["skillPackage"]["frontmatter"]
            .get("description")
            .is_none()
    );
    let files = package["skillPackage"]["files"].as_array_mut().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "references/checklist.md");
    assert_eq!(files[0]["size"], bytes.len());
    assert_eq!(
        STANDARD
            .decode(files[0]["base64"].as_str().unwrap())
            .unwrap(),
        bytes
    );
    files[0].as_object_mut().unwrap().remove("size");

    let target = open(&group.f, "recruiter", "en").await;
    package["agentId"] = target["agentId"].clone();
    package["expectedActiveId"] = Value::Null;
    let (status, installed) = group
        .f
        .request(
            "POST",
            &group.f.path("/skills/install"),
            Some(package),
            false,
            Some(&group.f.owner),
        )
        .await;
    assert_eq!(status, 201, "{installed}");
    assert_eq!(installed["agentId"], target["agentId"]);
    assert_eq!(installed["status"], "active");
    assert_eq!(installed["skillPackage"], skill["skillPackage"]);
    assert_eq!(
        group.store.get(Table::Skills, id).await.unwrap().unwrap()["status"],
        "proposed"
    );
}
