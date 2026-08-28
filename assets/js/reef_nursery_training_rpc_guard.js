import { authClient } from "./auth_client.js?v=25";

const WORKSPACE_RPCS = Object.freeze({
  submit: "ag_reef_training_workspace_submit",
  update: "ag_reef_training_workspace_update",
  detail: "ag_reef_training_workspace_detail"
});

export const LEGACY_TRAINING_RPC_MAP = Object.freeze({
  ag_submit_reef_nursery_session_v3: WORKSPACE_RPCS.submit,
  ag_update_reef_nursery_session_v3: WORKSPACE_RPCS.update,
  ag_save_reef_nursery_draft_v3: "workspace-save",
  ag_reef_nursery_session_detail_v4: WORKSPACE_RPCS.detail
});

const originalRpc = authClient.rpc.bind(authClient);

// The restored renderer still invokes the older authenticated Training RPCs
// for accounts that also have collection/photo permissions. Intercept only
// those Training calls. Public and authenticated Training therefore share the
// accepted workspace contract, while standalone Seaweed, Inspection, Storage
// and every unrelated RPC remain untouched.
authClient.rpc = async (name, args = {}) => {
  if (name === "ag_reef_nursery_session_detail_v4") {
    return originalRpc(WORKSPACE_RPCS.detail, {
      p_session_id: args.p_session_id
    });
  }

  if (name === "ag_submit_reef_nursery_session_v3") {
    return originalRpc(WORKSPACE_RPCS.submit, workspaceSubmitArgs(args));
  }

  if (name === "ag_update_reef_nursery_session_v3") {
    return originalRpc(WORKSPACE_RPCS.update, workspaceUpdateArgs(args));
  }

  if (name === "ag_save_reef_nursery_draft_v3") {
    // The accepted workspace has no new browser-created draft surface. The
    // DOM guard hides that action. Existing historical drafts can still save
    // their Training fields without replacing legacy child records.
    return args.p_session_id
      ? originalRpc(WORKSPACE_RPCS.update, workspaceUpdateArgs(args))
      : originalRpc(WORKSPACE_RPCS.submit, workspaceSubmitArgs(args));
  }

  return originalRpc(name, args);
};

function workspaceSubmitArgs(args) {
  return {
    p_submission_id: args.p_submission_id,
    p_session: args.p_session,
    p_participants: args.p_participants,
    p_training_delivered: args.p_training_delivered,
    p_practical_competencies: args.p_practical_competencies
  };
}

function workspaceUpdateArgs(args) {
  return {
    p_session_id: args.p_session_id,
    p_session: args.p_session,
    p_participants: args.p_participants,
    p_training_delivered: args.p_training_delivered,
    p_practical_competencies: args.p_practical_competencies
  };
}

export const REEF_TRAINING_RPC_GUARD_CONTRACT = Object.freeze({
  publicAndAuthenticatedWorkspace: true,
  legacyChildReplacementBlocked: true
});
