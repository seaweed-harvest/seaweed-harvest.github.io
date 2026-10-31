import { authClient, currentProfile, currentSession } from "./auth_client.js?v=22";
const url="https://seaweed-harvest-mcp-staging.seaweed-harvest.workers.dev/mcp";
const status=document.getElementById("mcpConnectionStatus");
const orgs=document.getElementById("mcpOrganisations");
const button=document.getElementById("copyMcpUrl");
const copyStatus=document.getElementById("mcpCopyStatus");
document.getElementById("mcpServerUrl").textContent=url;
async function init(){
  const session=await currentSession();
  if(!session){
    location.replace("./login.html?return="+encodeURIComponent("connect_chatgpt.html"));
    return;
  }
  const {data:userData,error:userError}=await authClient.auth.getUser();
  if(userError||!userData?.user)throw Error("Please sign in again.");
  const profile=await currentProfile(true);
  if(!profile || profile.id!==userData.user.id || profile.account_status!=="active")
    throw Error("Your Seaweed Harvest account is not active.");
  document.getElementById("mcpAdminLink").hidden=profile.is_protected_owner!==true;
  const {data,error}=await authClient.rpc("ag_my_mcp_access");
  if(error)throw Error("Could not check ChatGPT access.");
  if(data?.enabled!==true || !Array.isArray(data.organisation_codes) ||
     !data.organisation_codes.length){
    status.textContent="ChatGPT access isn't enabled. Ask your Seaweed Harvest administrator.";
    orgs.textContent="None";
    return;
  }
  status.textContent="ChatGPT access enabled";
  orgs.textContent=data.organisation_codes.join(", ");
  button.disabled=false;
}
button.addEventListener("click",async()=>{
  try{
    await navigator.clipboard.writeText(url);
    copyStatus.textContent="Server URL copied.";
  }catch{copyStatus.textContent="Select and copy the server URL above.";}
});
void init().catch(error=>{status.textContent=error?.message||"Connection unavailable.";});
