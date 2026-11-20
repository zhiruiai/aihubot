mod workspace_support;

use serde_json::json;
use workspace_support::Fixture;

#[tokio::test]
async fn starter_is_an_editable_idempotent_plan_without_model_or_implicit_work() {
    let f = Fixture::new().await;
    let catalog_path = f.path("/bot-team-templates");
    let (status, catalog) = f
        .request("GET", &catalog_path, None, false, Some(&f.owner))
        .await;
    assert_eq!(status, 200);
    let rows = catalog.as_array().unwrap();
    let ids: Vec<_> = rows
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "launch",
            "close",
            "support",
            "study",
            "creator",
            "office",
            "account-health",
            "software-product"
        ]
    );
    assert_eq!(catalog[0]["draft"]["title"], "产品发布小组");
    assert_eq!(
        f.request("GET", &catalog_path, None, true, Some(&f.member))
            .await
            .0,
        403
    );
    let before = f.bootstrap().await;
    assert_eq!(before["settings"]["configured"], false);
    let start_path = f.path("/bot-team-plans");
    let request = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "goal": "Review a launch",
        "template": {"id":"launch", "language":"en"}
    });
    assert_eq!(
        f.request(
            "POST",
            &start_path,
            Some(request.clone()),
            true,
            Some(&f.member)
        )
        .await
        .0,
        403
    );
    let (status, plan) = f
        .request(
            "POST",
            &start_path,
            Some(request.clone()),
            false,
            Some(&f.owner),
        )
        .await;
    assert_eq!(status, 202, "{plan}");
    assert_eq!(plan["status"], "ready");
    assert_eq!(plan["draft"]["title"], "Product Launch Team");
    assert_eq!(plan["draft"]["members"].as_array().unwrap().len(), 3);
    let (_, replay) = f
        .request(
            "POST",
            &start_path,
            Some(request.clone()),
            false,
            Some(&f.owner),
        )
        .await;
    assert_eq!(replay, plan);
    let mut conflict = request.clone();
    conflict["template"]["id"] = json!("close");
    assert_eq!(
        f.request("POST", &start_path, Some(conflict), false, Some(&f.owner))
            .await
            .0,
        409
    );
    for (language, title) in [
        ("en", "Customer Health Review Team"),
        ("zh-CN", "客户健康复盘小组"),
    ] {
        let (status, review) = f
            .request(
                "POST",
                &start_path,
                Some(json!({
                    "requestId": uuid::Uuid::new_v4().to_string(),
                    "goal": "Review synthetic account signals",
                    "template": {"id":"account-health", "language":language}
                })),
                false,
                Some(&f.owner),
            )
            .await;
        assert_eq!(status, 202, "{review}");
        assert_eq!(review["status"], "ready");
        assert_eq!(review["draft"]["title"], title);
        assert_eq!(review["draft"]["leadKey"], "signals");
        assert_eq!(review["draft"]["members"].as_array().unwrap().len(), 3);
        assert!(review["result"].is_null());
    }
    let staged = f.bootstrap().await;
    for key in ["agents", "conversations", "messages", "routines", "skills"] {
        assert_eq!(staged[key], before[key]);
    }

    let mut edited = plan["draft"].clone();
    edited["title"] = json!("Edited Launch");
    edited["leadKey"] = json!("review");
    let commit = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "expectedRevision": plan["revision"],
        "draft": edited
    });
    let (status, committed) = f
        .request(
            "POST",
            &f.path(&format!(
                "/bot-team-plans/{}/commit",
                plan["id"].as_str().unwrap()
            )),
            Some(commit),
            false,
            Some(&f.owner),
        )
        .await;
    assert_eq!(status, 200, "{committed}");
    let after = f.bootstrap().await;
    let group = after["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == committed["result"]["conversationId"])
        .unwrap();
    assert_eq!(group["title"], "Edited Launch");
    assert_eq!(group["agentIds"][0], committed["result"]["leadAgentId"]);
    assert_eq!(group["teamBrief"]["starterTemplateId"], "launch");
    verify_template_origin(&f, group).await;
    assert_eq!(after["messages"], before["messages"]);
    assert_eq!(after["routines"], before["routines"]);

    let mut second = request;
    second["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    let (status, repeated_template) = f
        .request("POST", &start_path, Some(second), false, Some(&f.owner))
        .await;
    assert_eq!(status, 202);
    assert_eq!(
        repeated_template["draft"]["members"][0]["name"],
        "Launch Coordinator 2"
    );
    f.close().await;
}

async fn verify_template_origin(f: &Fixture, group: &serde_json::Value) {
    use openbot_backend::workspace::Table;
    let id = group["id"].as_str().unwrap();
    let path = f.path(&format!("/conversations/{id}/settings"));
    let (_, current) = f.request("GET", &path, None, false, Some(&f.owner)).await;
    let mut patch = json!({"expectedRevision":current["revision"],"title":"Renamed team","agentIds":group["agentIds"],"teamBrief":group["teamBrief"]});
    patch["teamBrief"]["starterTemplateId"] = json!("study");
    assert_eq!(
        f.request("PATCH", &path, Some(patch.clone()), false, Some(&f.owner))
            .await
            .0,
        400
    );
    patch["teamBrief"]
        .as_object_mut()
        .unwrap()
        .remove("starterTemplateId");
    let (status, updated) = f
        .request("PATCH", &path, Some(patch), false, Some(&f.owner))
        .await;
    assert_eq!(status, 200, "{updated}");
    assert_eq!(
        updated["conversation"]["teamBrief"]["starterTemplateId"],
        "launch"
    );

    let store = f
        .state
        .workspace
        .get(&f.workspace, &f.workspace)
        .await
        .unwrap();
    let mut tx = store.begin().await.unwrap();
    let mut legacy = updated["conversation"].clone();
    legacy["teamBrief"]
        .as_object_mut()
        .unwrap()
        .remove("starterTemplateId");
    openbot_backend::workspace::WorkspaceStore::put_in(&mut tx, Table::Conversations, &legacy)
        .await
        .unwrap();
    let mut untracked = legacy.clone();
    untracked["id"] = json!(uuid::Uuid::new_v4().to_string());
    openbot_backend::workspace::WorkspaceStore::put_in(&mut tx, Table::Conversations, &untracked)
        .await
        .unwrap();
    openbot_backend::team_builder::initialize(&mut tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    legacy["teamBrief"]["starterTemplateId"] = json!("launch");
    assert_eq!(
        store.get(Table::Conversations, id).await.unwrap(),
        Some(legacy)
    );
    assert_eq!(
        store
            .get(Table::Conversations, untracked["id"].as_str().unwrap())
            .await
            .unwrap(),
        Some(untracked)
    );
}
