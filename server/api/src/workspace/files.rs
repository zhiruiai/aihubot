use super::{Table, WorkspaceAccess, WorkspaceStore, access, file_storage::Directory};
use crate::{
    agent::threads,
    db::{State, iso, now},
    error::{ApiError, Result, only_fields},
    speech::wav,
};
use axum::{
    Json,
    body::to_bytes,
    extract::{Path, Request, State as Extract},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path as FilePath, time::Duration};

async fn body(
    request: Request,
    state: &State,
    grant: &WorkspaceAccess,
    maximum: usize,
) -> Result<Vec<u8>> {
    let receive = to_bytes(request.into_body(), maximum);
    let timeout = tokio::time::sleep(Duration::from_secs(30));
    let mut check = tokio::time::interval(Duration::from_millis(200));
    tokio::pin!(receive, timeout);
    loop {
        tokio::select! {
            bytes = &mut receive => {
                grant.authorize(state).await?;
                return bytes.map(|v| v.to_vec()).map_err(|_| ApiError::new(413, "文件内容过大。"));
            }
            _ = &mut timeout => { return Err(ApiError::new(408, "文件上传超时，请重新上传。")); }
            _ = check.tick() => { grant.authorize(state).await?; }
        }
    }
}
fn mime(value: Option<&Value>) -> Result<String> {
    let Some(value) = value else {
        return Ok("application/octet-stream".into());
    };
    let text = value
        .as_str()
        .ok_or_else(|| ApiError::bad("文件类型无效。"))?;
    if text.is_empty() {
        return Ok("application/octet-stream".into());
    }
    if text.len() > 160
        || text.split('/').count() != 2
        || text.starts_with('/')
        || text.ends_with('/')
        || !text
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"!#$&^_.+-/".contains(&v))
    {
        return Err(ApiError::bad("文件类型无效。"));
    }
    Ok(text.to_owned())
}
pub async fn upload(
    Extract(state): Extract<State>,
    Path(wid): Path<String>,
    headers: HeaderMap,
    request: Request,
) -> Result<(StatusCode, Json<Value>)> {
    let grant = access::require(&state, &headers, &wid, false, true).await?;
    let store = grant.store(&state).await?;
    let bytes = body(request, &state, &grant, 15 * 1024 * 1024).await?;
    let input: Value =
        serde_json::from_slice(&bytes).map_err(|_| ApiError::bad("文件上传内容无效。"))?;
    only_fields(
        &input,
        &[
            "name",
            "content",
            "type",
            "conversationId",
            "voiceRecordingId",
            "threadRootId",
        ],
    )?;
    let name = input["name"]
        .as_str()
        .filter(|v| {
            !v.trim().is_empty()
                && v.encode_utf16().count() <= 160
                && !v.chars().any(char::is_control)
        })
        .ok_or_else(|| ApiError::bad("请提供有效的文件名（最多 160 个字符）。"))?;
    let content = input["content"]
        .as_str()
        .filter(|v| v.len() <= (10_usize * 1024 * 1024).div_ceil(3) * 4)
        .ok_or_else(|| ApiError::new(413, "文件最大为 10 MiB。"))?;
    let bytes = STANDARD
        .decode(content)
        .map_err(|_| ApiError::bad("文件内容不是有效的 Base64 数据。"))?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(ApiError::new(413, "文件最大为 10 MiB。"));
    }
    let file_type = mime(input.get("type"))?;
    let conversation = input
        .get("conversationId")
        .map(|v| {
            v.as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| ApiError::bad("会话标识无效。"))
        })
        .transpose()?;
    let thread = threads::request(input.get("threadRootId"))?;
    let recording_id = input
        .get("voiceRecordingId")
        .map(|value| {
            value
                .as_str()
                .filter(|id| {
                    uuid::Uuid::parse_str(id)
                        .is_ok_and(|uuid| uuid.get_version_num() == 4 && uuid.to_string() == *id)
                })
                .ok_or_else(|| ApiError::bad("语音消息标识无效。"))
        })
        .transpose()?;
    if thread.is_some() && recording_id.is_none() {
        return Err(ApiError::bad("请在会话中发送语音消息。"));
    }
    let (bytes, recording) = if let Some(id) = recording_id {
        if conversation.is_none()
            || file_type != "audio/wav"
            || name != format!("recording-{id}.wav")
        {
            return Err(ApiError::bad("请在会话中发送有效的WAV录音。"));
        }
        let (audio, duration_ms) = wav::parse(&bytes)?;
        if duration_ms < 250 {
            return Err(
                ApiError::new(422, "请至少录制四分之一秒。").with_code("VOICE_RECORDING_SHORT")
            );
        }
        let sha256 = hex::encode(Sha256::digest(&audio));
        (audio, Some((duration_ms, sha256)))
    } else {
        (bytes, None)
    };
    let id = recording_id
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut tx = store.begin().await?;
    grant.authorize(&state).await?;
    if let Some(cid) = conversation {
        WorkspaceStore::get_in(&mut tx, Table::Conversations, cid)
            .await?
            .ok_or_else(|| ApiError::new(404, "会话不存在。"))?;
        if let Some(thread_id) = thread {
            threads::root(&mut tx, cid, thread_id).await?;
        }
    }
    if let Some((_, sha256)) = &recording {
        let previous_file = WorkspaceStore::get_in(&mut tx, Table::Files, &id).await?;
        let previous_message = WorkspaceStore::get_in(&mut tx, Table::Messages, &id).await?;
        if previous_file.is_some() || previous_message.is_some() {
            if let (Some(file), Some(message)) = (previous_file, previous_message) {
                if file["sha256"] == sha256.as_str()
                    && message["metadata"]["voiceRecording"].is_object()
                    && message["metadata"]["fileId"] == id.as_str()
                    && message["userId"] == grant.user_id
                    && message["conversationId"].as_str() == conversation
                    && message["threadRootId"].as_str() == thread
                {
                    grant.authorize(&state).await?;
                    return Ok((StatusCode::CREATED, Json(file)));
                }
            }
            return Err(ApiError::new(409, "语音消息与已提交的内容不一致。"));
        }
    }
    let directory = Directory::open(&store.directory, true)?;
    let display_name = name;
    let (name, uploaded) = directory.upload(name, &bytes, &id)?;
    let mut file =
        json!({"id":id,"name":name,"size":bytes.len(),"type":file_type,"createdAt":iso(now())});
    if let Some(cid) = conversation {
        file["conversationId"] = json!(cid);
    }
    if let Some((_, sha256)) = &recording {
        file["sha256"] = json!(sha256);
    }
    WorkspaceStore::put_in(&mut tx, Table::Files, &file).await?;
    let message = if let Some(cid) = conversation {
        let message_id = if recording.is_some() {
            id.clone()
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        let mut message = json!({"id":message_id,"conversationId":cid,"role":"user","kind":"file","userId":grant.user_id,"content":display_name,"createdAt":file["createdAt"],"metadata":{"fileId":id,"name":display_name,"size":bytes.len(),"author":{"id":grant.user_id,"name":grant.user_name,"kind":"user"}}});
        if let Some((duration_ms, sha256)) = &recording {
            message["metadata"]["name"] = file["name"].clone();
            message["metadata"]["sha256"] = json!(sha256);
            message["metadata"]["voiceRecording"] = json!({"durationMs":duration_ms});
            threads::stamp(&mut message, thread);
        }
        WorkspaceStore::put_in(&mut tx, Table::Messages, &message).await?;
        Some(message)
    } else {
        None
    };
    grant.authorize(&state).await?;
    tx.commit().await?;
    uploaded.commit();
    if let Some(message) = message {
        store.emit("message", message);
    }
    store.emit("update", json!({}));
    grant.authorize(&state).await?;
    Ok((StatusCode::CREATED, Json(file)))
}
pub async fn download(
    Extract(state): Extract<State>,
    Path((wid, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response> {
    let grant = access::require(
        &state,
        &headers,
        &wid,
        false,
        headers.contains_key("x-openbot-expected-user"),
    )
    .await?;
    let store = grant.store(&state).await?;
    let file = store
        .get(Table::Files, &id)
        .await?
        .ok_or_else(|| ApiError::new(404, "文件不存在。"))?;
    let name = file["name"]
        .as_str()
        .ok_or_else(|| ApiError::new(409, "文件记录无效。"))?;
    let file_reader = Directory::open(&store.directory, false)?.reader(name)?;
    let length = file_reader.len();
    let mut delivered_name = file["downloadName"].as_str().map(str::to_owned);
    if delivered_name.is_none() && file["source"]["kind"] == "workspace_delivery" {
        // Older deliveries retained the original name in their receipt only.
        delivered_name = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(data, '$.metadata.name') FROM messages
             WHERE id GLOB 'delivery-*'
               AND json_extract(data, '$.metadata.fileId') = ? LIMIT 1",
        )
        .bind(&id)
        .fetch_optional(&store.pool)
        .await?
        .flatten();
    }
    grant.authorize(&state).await?;
    let public_name = FilePath::new(delivered_name.as_deref().unwrap_or(name))
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let encoded: String = public_name
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let stream = futures_util::stream::try_unfold(
        (file_reader, state, grant, store),
        |(mut reader, state, grant, store)| async move {
            let fail = || {
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "File transfer interrupted",
                )
            };
            if store.is_closed() {
                return Err(fail());
            }
            grant.authorize(&state).await.map_err(|_| fail())?;
            let (reader, chunk) = tokio::task::spawn_blocking(move || {
                let result = reader.next();
                (reader, result)
            })
            .await
            .map_err(|_| fail())?;
            grant.authorize(&state).await.map_err(|_| fail())?;
            Ok(chunk
                .map_err(|_| fail())?
                .map(|bytes| (bytes, (reader, state, grant, store))))
        },
    );
    let mut response = axum::body::Body::from_stream(stream).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(
            &mime(file.get("type")).unwrap_or_else(|_| "application/octet-stream".into()),
        )
        .map_err(|_| ApiError::bad("文件类型无效。"))?,
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"download\"; filename*=UTF-8''{encoded}"
        ))
        .map_err(|_| ApiError::bad("文件名称无效。"))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    Ok(response)
}
pub async fn remove(
    Extract(state): Extract<State>,
    Path((wid, id)): Path<(String, String)>,
    headers: HeaderMap,
    request: Request,
) -> Result<Json<Value>> {
    let grant = access::require(&state, &headers, &wid, false, true).await?;
    let bytes = body(request, &state, &grant, 1024).await?;
    if !bytes.is_empty() && serde_json::from_slice::<Value>(&bytes).ok() != Some(json!({})) {
        return Err(ApiError::bad("删除文件不接受额外内容。"));
    }
    let store = grant.store(&state).await?;
    let mut tx = store.begin().await?;
    let file = WorkspaceStore::get_in(&mut tx, Table::Files, &id)
        .await?
        .ok_or_else(|| ApiError::new(404, "文件不存在。"))?;
    let name = file["name"]
        .as_str()
        .ok_or_else(|| ApiError::new(409, "文件记录无效。"))?;
    grant.authorize(&state).await?;
    let removed = match Directory::open(&store.directory, false)
        .and_then(|directory| directory.remove(name))
    {
        Ok(removed) => Some(removed),
        Err(error) if error.code == "FILE_NOT_FOUND" => None,
        Err(error) => return Err(error),
    };
    WorkspaceStore::delete_in(&mut tx, Table::Files, &id).await?;
    grant.authorize(&state).await?;
    tx.commit().await?;
    if let Some(removed) = removed {
        removed.commit()?;
    }
    store.emit("update", json!({}));
    grant.authorize(&state).await?;
    Ok(Json(json!({"ok":true})))
}
