import { authClient, currentProfile, currentSession } from "./auth_client.js?v=22";

const id = new URLSearchParams(location.search).get("authorization_id");
const els = Object.fromEntries([
  "consentStatus", "consentDetails", "consentClient", "consentAccount",
  "consentRedirect", "consentScopes", "consentAccess", "consentApprove", "consentDeny"
].map(name=>[name,document.getElementById(name)]));

function status(message){ els.consentStatus.textContent=message; }
function approvedRedirect(candidate,registered){
  // Supabase returns the registered redirect URI. Only support known MCP
  // clients, and never allow the returned redirect to change its origin/path.
  try{
    const target=new URL(candidate), expected=new URL(registered);
    const chatgpt=target.origin==="https://chatgpt.com" &&
      (target.pathname==="/connector_platform_oauth_redirect" ||
       /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(target.pathname));
    // Codex's native OAuth callback uses an ephemeral loopback port and path.
    const local=target.protocol==="http:" && target.hostname==="127.0.0.1" &&
      Number(target.port)>=1024 && Number(target.port)<=65535 &&
      /^\/callback\/[A-Za-z0-9_-]{8,128}$/.test(target.pathname);
    return (chatgpt||local) &&
      target.origin===expected.origin && target.pathname===expected.pathname
      ?target.href:null;
  }catch{return null;}
}
async function init(){
  if(!id || !/^[A-Za-z0-9_-]{8,256}$/.test(id))throw Error("Invalid authorization request");
  const session=await currentSession();
  if(!session){
    const back="oauth_consent.html?authorization_id="+encodeURIComponent(id);
    location.replace("./login.html?return="+encodeURIComponent(back));
    return;
  }
  const { data:authUser,error:userError }=await authClient.auth.getUser();
  if(userError||!authUser.user)throw Error("Session validation failed. Please sign in again.");
  const profile=await currentProfile(true);
  if(profile?.account_status!=="active" || profile.id!==authUser.user.id)
    throw Error("Your Seaweed Harvest account is not active.");
  const {data:access,error:accessError}=await authClient.rpc("ag_my_mcp_access");
  if(accessError)throw Error("ChatGPT access could not be checked.");
  if(access?.enabled!==true || !Array.isArray(access.organisation_codes) ||
     !access.organisation_codes.length)
    throw Error("ChatGPT access has not been enabled for your Seaweed Harvest account.");
  // This early consent gate is checked again on every MCP data request by the Worker.
  if(!authClient.auth.oauth?.getAuthorizationDetails)throw Error("OAuth support is unavailable in this version of Seaweed Harvest.");
  const {data:details,error}=await authClient.auth.oauth.getAuthorizationDetails(id);
  if(error||!details)throw Error(error?.message||"The authorization request is unavailable.");
  if(!details.authorization_id){
    const redirect=approvedRedirect(details.redirect_url,details.redirect_url);
    if(!redirect)throw Error("Unrecognised redirect destination");
    location.assign(redirect);return;
  }
  const registered=details.redirect_uri;
  if(!registered || !approvedRedirect(registered,registered))throw Error("Unsupported OAuth redirect for this connection");
  els.consentClient.textContent=details.client?.name||"ChatGPT";
  els.consentAccount.textContent=profile.display_name||authUser.user.email||"Seaweed Harvest user";
  els.consentRedirect.textContent=registered;
  els.consentScopes.textContent=details.scope||"Email";
  els.consentAccess.textContent=access.organisation_codes.join(", ");
  status("Review this request before allowing access.");
  els.consentDetails.hidden=false;
  els.consentApprove.disabled=false;
  els.consentDeny.disabled=false;
  async function decide(allow){
    els.consentApprove.disabled=true;els.consentDeny.disabled=true;
    status(allow?"Approving…":"Denying…");
    try{
      const action=allow?"approveAuthorization":"denyAuthorization";
      // Let this page validate and perform the only browser redirect.
      // Supabase's default auto-redirect can leave a native loopback
      // authorization page showing "Approving…" while the client completes.
      const {data:result,error:actionError}=await authClient.auth.oauth[action](id,{skipBrowserRedirect:true});
      if(actionError||!result?.redirect_url)throw Error(actionError?.message||"Could not complete authorization");
      const redirect=approvedRedirect(result.redirect_url,registered);
      if(!redirect)throw Error("The destination did not match the approved registered callback.");
      status(allow?"Opening your connected app…":"Returning to your connected app…");
      location.assign(redirect);
    }catch(error){
      status(error.message||"Authorization failed.");
      els.consentApprove.disabled=false;els.consentDeny.disabled=false;
    }
  }
  els.consentApprove.addEventListener("click",()=>void decide(true));
  els.consentDeny.addEventListener("click",()=>void decide(false));
}
void init().catch(error=>status(error?.message||"Authorization unavailable."));
