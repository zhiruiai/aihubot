use super::{computer_tools, registry::ActiveRun, tools, web_tools, website_delivery};
use crate::workspace::WorkspaceStore;
use serde::Serialize;
use serde_json::json;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RunActivity {
    Research,
    Files,
    Website,
    Skill,
    Collaborating,
    ConnectedApp,
    Computer,
}

#[derive(Clone, Copy, Default)]
pub(super) struct RunActivityState {
    pub phase: Option<RunActivity>,
    pub revision: u32,
}

fn for_tool(name: &str) -> Option<RunActivity> {
    Some(match name {
        web_tools::SEARCH | web_tools::FETCH => RunActivity::Research,
        website_delivery::TOOL | website_delivery::READ_TOOL => RunActivity::Website,
        "workspace_list" | "workspace_read" | "workspace_write" | "workspace_append"
        | "workspace_edit" | "workspace_deliver" => RunActivity::Files,
        "read_skill" | "read_skill_resource" | computer_tools::RUN_SKILL_SCRIPT => {
            RunActivity::Skill
        }
        "delegate" => RunActivity::Collaborating,
        "app_action" => RunActivity::ConnectedApp,
        "computer_observe"
        | "computer_action"
        | "computer_accessibility"
        | "computer_open_mac_app"
        | "computer_set_mac_text" => RunActivity::Computer,
        _ => return None,
    })
}

impl ActiveRun {
    pub(super) fn activity(&self) -> RunActivityState {
        *self
            .activity
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    pub(super) fn set_tool_activity(&self, store: &WorkspaceStore, name: &str, generation: u64) {
        if tools::check_fence(self, generation).is_ok() {
            self.set_activity(store, for_tool(name));
        }
    }

    pub(super) fn set_activity(&self, store: &WorkspaceStore, next: Option<RunActivity>) {
        let mut activity = self
            .activity
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if activity.phase != next {
            activity.phase = next;
            activity.revision += 1;
            store.emit_run_activity(json!({
                "runId": self.run_id, "revision": activity.revision, "activity": next
            }));
        }
    }
}
