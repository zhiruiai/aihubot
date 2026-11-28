mod agent_delegation_support;
mod workspace_media_support;
mod workspace_support;
use agent_delegation_support::*;
use axum::body::Body;
use openbot_backend::workspace::Table;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn last_tool(body: &Value) -> Value {
    let message = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|message| message["role"] == "tool")
        .unwrap();
    serde_json::from_str(message["content"].as_str().unwrap()).unwrap()
}
fn node(group: &mut Group) {
    if let Some(node) = std::env::var_os("OPENBOT_NODE") {
        Arc::make_mut(&mut group.f.state.config).node_binary = node.into();
    }
}

#[tokio::test]
async fn final_file_delivery_is_a_real_card_and_keeps_its_bytes_after_source_edit() {
    let mut group = Group::new().await;
    node(&mut group);
    let count = Arc::new(AtomicUsize::new(0));
    let receipt = Arc::new(Mutex::new(Value::Null));
    let step = count.clone();
    let accepted = receipt.clone();
    let model = Model::new(Arc::new(move |body| {
        let step = step.clone();
        let accepted = accepted.clone();
        Box::pin(async move {
            match step.fetch_add(1, Ordering::SeqCst) {
                0 => call(
                    "workspace_write",
                    json!({"path":"report.html","content":"<h1>FINAL_SYNTHETIC_REPORT</h1>"}),
                ),
                1 => call(
                    "workspace_deliver",
                    json!({"path":"report.html","expectedSha256":last_tool(&body)["sha256"]}),
                ),
                2 => {
                    let result = last_tool(&body);
                    assert_eq!(result["delivered"], true);
                    *accepted.lock().unwrap() = result.clone();
                    call(
                        "workspace_deliver",
                        json!({"path":"report.html","expectedSha256":result["sha256"]}),
                    )
                }
                3 => {
                    assert_eq!(
                        last_tool(&body),
                        *accepted.lock().unwrap(),
                        "Same run/version must reuse its actual receipt"
                    );
                    call(
                        "workspace_write",
                        json!({"path":"report.html","content":"SOURCE_CHANGED_AFTER_DELIVERY"}),
                    )
                }
                4 => finish("The final report was delivered as a file."),
                _ => panic!("Unexpected model request"),
            }
        })
    }))
    .await;
    group.configure(&model).await;
    group
        .send(
            "Create and deliver a synthetic report, then edit only the source.",
            "followUp",
            false,
        )
        .await;
    let messages = group.done().await;
    let files: Vec<_> = messages
        .iter()
        .filter(|message| message["role"] == "assistant" && message["kind"] == "file")
        .collect();
    assert_eq!(
        files.len(),
        1,
        "Repeated delivery must not create duplicate cards"
    );
    let receipt = receipt.lock().unwrap().clone();
    assert_eq!(files[0]["metadata"]["fileId"], receipt["fileId"]);
    assert_eq!(files[0]["metadata"]["name"], "report.html");
    let id = receipt["fileId"].as_str().unwrap();
    for legacy in [false, true] {
        if legacy {
            let mut file = group.store.get(Table::Files, id).await.unwrap().unwrap();
            file.as_object_mut().unwrap().remove("downloadName");
            group.store.put(Table::Files, &file).await.unwrap();
        }
        let (status, headers, bytes) = workspace_media_support::raw(
            &group.f,
            "GET",
            &group.f.path(&format!("/files/{id}/download")),
            "application/json",
            Body::empty(),
            false,
            Some(&group.f.owner),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(bytes, b"<h1>FINAL_SYNTHETIC_REPORT</h1>");
        assert_eq!(
            headers["content-disposition"],
            "attachment; filename=\"download\"; filename*=UTF-8''report.html"
        );
    }
    let records = group.store.list(Table::Files).await.unwrap();
    assert_eq!(records.len(), 2);
    let original = records
        .iter()
        .find(|file| file["name"] == "report.html")
        .unwrap();
    assert_ne!(original["id"], receipt["fileId"]);
    let foreign = format!("/api/workspaces/{}/files/{id}/download", group.f.foreign);
    assert_ne!(
        group
            .f
            .request("GET", &foreign, None, false, Some(&group.f.owner))
            .await
            .0,
        200
    );
    assert_eq!(count.load(Ordering::SeqCst), 5);
    drop(model);
    group.close().await;
}

#[tokio::test]
async fn a_new_bot_can_deliver_its_skill_file_even_when_its_final_reply_is_cut_short() {
    let mut group = Group::new().await;
    node(&mut group);
    let steps = Arc::new(AtomicUsize::new(0));
    let count = steps.clone();
    let model = Model::new(Arc::new(move |body| {
        let step = count.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            assert_eq!(role(&body), 0);
            match step {
                0 => call("list_skills", json!({"query":"web-research"})),
                1 => call(
                    "read_skill",
                    json!({"skillId":last_tool(&body)["skills"][0]["id"]}),
                ),
                2 => {
                    let skill = last_tool(&body);
                    assert_eq!(skill["skillPackage"]["root"], "web-research");
                    call(
                        "workspace_write",
                        json!({"path":"review.md","content":skill["content"]}),
                    )
                }
                3 => call(
                    "workspace_deliver",
                    json!({"path":"review.md","expectedSha256":last_tool(&body)["sha256"]}),
                ),
                4 => {
                    assert_eq!(last_tool(&body)["delivered"], true);
                    response(
                        json!({"role":"assistant","content":"First paragraph of the review."}),
                        "length",
                    )
                }
                _ => panic!("A truncated reply must not replay completed work"),
            }
        })
    }))
    .await;
    let (status, saved) = group
        .f
        .request(
            "POST",
            &group.f.path("/model-profiles"),
            Some(model.config()),
            false,
            Some(&group.f.owner),
        )
        .await;
    assert_eq!(status, 201, "{saved}");
    let (status, bot) = group
        .f
        .request(
            "PATCH",
            &group.f.path(&format!("/agents/{}", group.ids[0])),
            Some(json!({"modelProfileId":saved["profile"]["id"]})),
            false,
            Some(&group.f.owner),
        )
        .await;
    assert_eq!(status, 200, "{bot}");
    group
        .send(
            "Deliver your reviewed research instructions and summarize them.",
            "followUp",
            false,
        )
        .await;
    let messages = group.done().await;
    let partial = messages
        .iter()
        .find(|m| m["role"] == "assistant" && m["kind"] == "text")
        .unwrap();
    assert_eq!(partial["status"], "error", "{partial}");
    let text = partial["content"].as_str().unwrap();
    assert!(text.contains("First paragraph of the review.") && text.contains("输出长度上限"));
    let files: Vec<_> = messages.iter().filter(|m| m["kind"] == "file").collect();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["status"], "done");
    let id = files[0]["metadata"]["fileId"].as_str().unwrap();
    let (status, download) = group
        .f
        .request(
            "GET",
            &group.f.path(&format!("/files/{id}/download")),
            None,
            false,
            Some(&group.f.owner),
        )
        .await;
    assert_eq!(status, 200, "{download}");
    let source = group
        .store
        .list(Table::Skills)
        .await
        .unwrap()
        .into_iter()
        .find(|s| s["agentId"] == group.ids[0] && s["name"] == "web-research")
        .unwrap();
    assert_eq!(download["invalid"], source["content"]);
    assert_eq!(steps.load(Ordering::SeqCst), 5);
    group.close().await;
}

#[tokio::test]
async fn unregistered_files_stale_versions_and_traversal_never_produce_delivery_cards() {
    let mut group = Group::new().await;
    node(&mut group);
    std::fs::create_dir_all(group.store.directory.join("workspace")).unwrap();
    std::fs::write(
        group.store.directory.join("workspace/unregistered.txt"),
        "UNREGISTERED",
    )
    .unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let step = count.clone();
    let model = Model::new(Arc::new(move |body| {
        let step = step.clone();
        Box::pin(async move {
            match step.fetch_add(1, Ordering::SeqCst) {
                0 => call("workspace_deliver", json!({"path":"unregistered.txt","expectedSha256":hex::encode(Sha256::digest(b"UNREGISTERED"))})),
                1 => {
                    assert!(body.to_string().contains("文件不存在"));
                    call("workspace_write", json!({"path":"draft.txt","content":"SYNTHETIC_DRAFT"}))
                }
                2 => call("workspace_deliver", json!({"path":"draft.txt","expectedSha256":"0".repeat(64)})),
                3 => {
                    assert!(body.to_string().contains("文件版本已变化"));
                    call("workspace_deliver", json!({"path":"../outside.txt","expectedSha256":"0".repeat(64)}))
                }
                4 => finish("Invalid deliveries were refused."),
                _ => panic!("Unexpected model request"),
            }
        })
    })).await;
    group.configure(&model).await;
    group
        .send(
            "Exercise only the synthetic delivery rejection fixtures.",
            "followUp",
            false,
        )
        .await;
    let messages = group.done().await;
    assert!(
        !messages
            .iter()
            .any(|message| message["role"] == "assistant" && message["kind"] == "file")
    );
    assert_eq!(group.store.list(Table::Files).await.unwrap().len(), 1);
    assert_eq!(count.load(Ordering::SeqCst), 5);
    drop(model);
    group.close().await;
}
