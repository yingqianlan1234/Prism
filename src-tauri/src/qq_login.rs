//! QQ QR login candidate. All destinations are fixed; no secret is returned by IPC.
use std::{sync::Mutex, time::{Duration, Instant}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use rand::{distributions::Alphanumeric, Rng};
use tauri::State;
use crate::{err, Error, Result};
use crate::qq_login_offline::{Credential, CredentialStore, SystemCredentialStore, LoginState, LoginEvent, transition};

const QR_SHOW: &str = "https://ssl.ptlogin2.qq.com/ptqrshow";
const QR_POLL: &str = "https://ssl.ptlogin2.qq.com/ptqrlogin";
const CHECK_SIG: &str = "https://ssl.ptlogin2.graph.qq.com/check_sig";
const AUTHORIZE: &str = "https://graph.qq.com/oauth2.0/authorize";
const MUSIC_API: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const REFERRER: &str = "https://xui.ptlogin2.qq.com/";
const REDIRECT: &str = "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/";
const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: usize = 256 * 1024;

struct Session { generation:u64, qr:Option<QrSession>, busy:bool, phase:LoginState }
impl Default for Session {fn default()->Self{Self{generation:0,qr:None,busy:false,phase:LoginState::Idle}}}
struct QrSession { signature:String, created:Instant }
pub struct QqLogin { client:reqwest::Client, state:Mutex<Session> }
impl QqLogin {
 pub fn new()->Self {Self{client:reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never()).build().expect("QQ HTTP client"),state:Mutex::new(Session::default())}}
 fn state(&self)->Result<std::sync::MutexGuard<'_,Session>> {self.state.lock().map_err(|_|err("storage","QQ 会话不可用"))}
 fn current(&self,generation:u64)->Result<()> {let s=self.state()?;if s.generation!=generation {Err(err("cancelled","QQ 登录已取消"))} else if s.qr.as_ref().is_some_and(|q|q.created.elapsed()>TIMEOUT) {Err(err("timeout","QQ 二维码已过期"))} else {Ok(())}}
}
fn net(e:reqwest::Error)->Error {if e.is_timeout(){err("timeout","QQ 登录请求超时")}else{err("network","无法连接 QQ 登录服务")}}
fn hash33(s:&str, seed:u32)->u32 {s.bytes().fold(seed,|a,c|a.wrapping_mul(33).wrapping_add(c as u32)) & 0x7fff_ffff}
fn valid_secret(s:&str)->bool {!s.is_empty()&&s.len()<=2048&&s.bytes().all(|c|c.is_ascii_graphic()&&c!=b';'&&c!=b','&&c!=b'"')}
fn cookies(res:&reqwest::Response,names:&[&str])->Vec<(String,String)> {
 res.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|h|h.to_str().ok()).filter_map(|s|s.split(';').next()).filter_map(|s|s.split_once('=')).filter(|(k,v)|names.contains(k)&&valid_secret(v)).map(|(k,v)|(k.to_string(),v.to_string())).collect()
}
fn cookie_value<'a>(items:&'a [(String,String)], key:&str)->Option<&'a str> {items.iter().find(|(k,_)|k==key).map(|(_,v)|v.as_str())}
async fn bytes(mut res:reqwest::Response)->Result<Vec<u8>> {if !res.status().is_success(){return Err(err("upstream","QQ 服务请求失败"));}if res.content_length().is_some_and(|n|n>MAX_BODY as u64){return Err(err("upstream","QQ 服务响应过大"));}let mut out=Vec::new();while let Some(c)=res.chunk().await.map_err(net)?{if c.len()>MAX_BODY-out.len(){return Err(err("upstream","QQ 服务响应过大"));}out.extend_from_slice(&c);}Ok(out)}
fn qr_poll_result(body:&str)->Result<(i32,Option<(String,String)>)> {
 if body.len()>MAX_BODY||!body.starts_with("ptuiCB(") {return Err(err("upstream","QQ 登录状态格式异常"));}
 let parts:Vec<&str>=body.split('\'').collect();let code=parts.get(1).and_then(|s|s.parse::<i32>().ok()).ok_or(err("upstream","QQ 登录状态格式异常"))?;
 if code!=0{return Ok((code,None));}
 let url=reqwest::Url::parse(parts.get(5).ok_or(err("upstream","QQ 登录响应不完整"))?).map_err(|_|err("upstream","QQ 登录响应不完整"))?;
 if url.scheme()!="https"||!matches!(url.host_str(),Some("ssl.ptlogin2.graph.qq.com")|Some("ssl.ptlogin2.qq.com")){return Err(err("upstream","QQ 登录回调域名异常"));}
 let mut uin=None;let mut sig=None;for(k,v) in url.query_pairs(){if k=="uin"{uin=Some(v.into_owned())}else if k=="ptsigx"{sig=Some(v.into_owned())}}
 let uin=uin.filter(|s|!s.is_empty()&&s.len()<=32&&s.bytes().all(|b|b.is_ascii_digit())).ok_or(err("upstream","QQ 登录响应不完整"))?;
 let sig=sig.filter(|s|valid_secret(s)).ok_or(err("upstream","QQ 登录响应不完整"))?;Ok((code,Some((uin,sig))))
}
fn oauth_code(location:&str,state:&str)->Result<String>{let u=reqwest::Url::parse(location).map_err(|_|err("upstream","QQ 授权响应异常"))?;if u.scheme()!="https"||u.port_or_known_default()!=Some(443)||!u.username().is_empty()||u.password().is_some()||u.fragment().is_some(){return Err(err("upstream","QQ 授权回调协议异常"));}if u.host_str()!=Some("y.qq.com"){let message=match u.host_str(){Some("graph.qq.com")=>match u.path(){"/oauth2.0/show"=>{let kind=u.query_pairs().find(|(k,_)|k=="which").map(|(_,v)|v.into_owned());match kind.as_deref(){Some("Login")=>"QQ 要求重新登录，请停止并核对账号安全",Some("Auth")=>"QQ 要求额外授权确认，请停止并核对",_=>"QQ 返回授权页面，请停止并核对"}},"/oauth2.0/login_jump"=>"QQ 返回登录中转页，请停止并核对","/oauth2.0/authorize"=>"QQ 返回授权入口，请停止并核对",_=>"QQ 授权返回 graph.qq.com 的其他路径，已停止"},Some("ssl.ptlogin2.qq.com")=>"QQ 授权返回 ssl.ptlogin2.qq.com，未进入预期回调",Some("ssl.ptlogin2.graph.qq.com")=>"QQ 授权返回 ssl.ptlogin2.graph.qq.com，未进入预期回调",Some("xui.ptlogin2.qq.com")=>"QQ 授权返回 xui.ptlogin2.qq.com，未进入预期回调",_=>"QQ 授权返回未知主机，已停止"};return Err(err("upstream",message));}if u.path()!="/portal/wx_redirect.html"{return Err(err("upstream","QQ 授权返回 y.qq.com 的非预期路径"));}let pairs:Vec<_>=u.query_pairs().collect();let states:Vec<_>=pairs.iter().filter(|(k,_)|k=="state").collect();if states.len()!=1||states[0].1!=state{return Err(err("auth","QQ 授权状态不匹配"));}let codes:Vec<_>=pairs.iter().filter(|(k,_)|k=="code").collect();if codes.len()!=1{return Err(err("upstream","QQ 授权未返回有效结果"));}let code=codes[0].1.to_string();if !valid_secret(&code){return Err(err("upstream","QQ 授权未返回有效结果"));}Ok(code)}
fn response_data(data:Value)->Result<Value>{if data.get("code").and_then(Value::as_i64)!=Some(0)||data.pointer("/req_0/code").and_then(Value::as_i64)!=Some(0){return Err(err("auth","QQ 服务拒绝登录或需要安全验证"));}data.pointer("/req_0/data").filter(|v|v.is_object()).cloned().ok_or(err("upstream","QQ 服务资料不完整"))}
fn token_fields(v:&Value)->Result<(String,String)>{let id=v.get("musicid").and_then(|v|v.as_str().map(str::to_owned).or_else(||v.as_u64().map(|n|n.to_string()))).filter(|s|!s.is_empty()&&s.bytes().all(|c|c.is_ascii_digit())).ok_or(err("auth","QQ 登录未返回有效账号"))?;let key=v.get("musickey").and_then(Value::as_str).filter(|s|valid_secret(s)).ok_or(err("auth","QQ 登录未返回有效凭据"))?;Ok((id,key.to_owned()))}
fn profile_value(data:Value,id:&str)->Result<Value>{let name=data.get("nick").or_else(||data.get("nickname")).or_else(||data.pointer("/info/nick")).or_else(||data.pointer("/userinfo/nick")).and_then(Value::as_str).filter(|s|!s.trim().is_empty()).ok_or(err("upstream","QQ 账号资料不完整"))?;Ok(json!({"userId":id,"nickname":name}))}
async fn api(client:&reqwest::Client,module:&str,method:&str,param:Value,cred:Option<&Value>)->Result<Value>{let mut comm=json!({"ct":24,"cv":4747474,"platform":"yqq.json","format":"json","g_tk":5381,"g_tk_new_20200303":5381});let mut req=client.post(MUSIC_API);if let Some(cred)=cred{let(id,key)=token_fields(cred)?;let gtk=hash33(&key,5381);comm["uin"]=json!(id);comm["authst"]=json!(key);comm["g_tk"]=json!(gtk);comm["g_tk_new_20200303"]=json!(gtk);req=req.header("Cookie",format!("uin={id}; qqmusic_uin={id}; qm_keyst={key}; qqmusic_key={key}"));}else{comm["tmeLoginType"]=json!(2);}
 let res=req.header("Referer","https://y.qq.com/").json(&json!({"comm":comm,"req_0":{"module":module,"method":method,"param":param}})).send().await.map_err(net)?;let body=bytes(res).await?;response_data(serde_json::from_slice(&body).map_err(|_|err("upstream","QQ 服务返回格式异常"))?) }
async fn profile(client:&reqwest::Client,cred:&Value)->Result<Value>{let(id,_)=token_fields(cred)?;let data=api(client,"music.UserInfo.userInfoServer","GetLoginUserInfo",json!({}),Some(cred)).await?;profile_value(data,&id)}
#[tauri::command]
pub async fn qq_qr_start(app:State<'_,QqLogin>)->Result<Value>{let generation={let mut s=app.state()?;s.generation+=1;s.qr=None;s.busy=false;s.phase=LoginState::Idle;s.generation};let res=app.client.get(QR_SHOW).query(&[("appid","716027609"),("e","2"),("l","M"),("s","3"),("d","72"),("v","4"),("daid","383"),("pt_3rd_aid","100497308")]).header("Referer",REFERRER).send().await.map_err(net)?;let sig=cookie_value(&cookies(&res,&["qrsig"]),"qrsig").ok_or(err("upstream","QQ 登录未返回二维码会话"))?.to_owned();let img=bytes(res).await?;if !img.starts_with(b"\x89PNG\r\n\x1a\n"){return Err(err("upstream","QQ 二维码格式异常"));}let mut s=app.state()?;if s.generation!=generation{return Err(err("cancelled","QQ 登录已取消"));}s.phase=transition(s.phase,LoginEvent::Start).map_err(|_|err("validation","QQ 登录状态异常"))?;s.qr=Some(QrSession{signature:sig,created:Instant::now()});Ok(json!({"image":format!("data:image/png;base64,{}",STANDARD.encode(img))}))}
#[tauri::command]
pub fn qq_qr_cancel(app:State<'_,QqLogin>)->Result<Value>{let mut s=app.state()?;s.generation+=1;s.qr=None;s.busy=false;s.phase=LoginState::Idle;Ok(json!({"cancelled":true}))}
#[tauri::command]
pub async fn qq_qr_check(app:State<'_,QqLogin>)->Result<Value>{let (generation,sig)={let mut s=app.state()?;if s.busy{return Err(err("validation","QQ 登录检查正在进行"));}let qr=s.qr.as_ref().ok_or(err("validation","请重新获取 QQ 二维码"))?;if qr.created.elapsed()>TIMEOUT{s.qr=None;s.phase=LoginState::Expired;return Ok(json!({"status":"expired"}));}let sig=qr.signature.clone();s.busy=true;(s.generation,sig)};
 let result=check(&app,generation,&sig).await;let mut s=app.state()?;if s.generation!=generation{return Err(err("cancelled","QQ 登录已取消"));}s.busy=false;match result.as_ref().ok().and_then(|v|v.get("status")).and_then(Value::as_str){Some("scanned") if s.phase==LoginState::WaitingScan=>{s.phase=transition(s.phase,LoginEvent::Scanned).map_err(|_|err("validation","QQ 登录状态异常"))?;},Some("success")=>{if s.phase==LoginState::WaitingScan{s.phase=transition(s.phase,LoginEvent::Scanned).map_err(|_|err("validation","QQ 登录状态异常"))?;}s.phase=transition(s.phase,LoginEvent::Confirmed).map_err(|_|err("validation","QQ 登录状态异常"))?;s.phase=transition(s.phase,LoginEvent::Authenticated).map_err(|_|err("validation","QQ 登录状态异常"))?;s.generation+=1;},Some("expired")=>s.phase=LoginState::Expired,Some("refused")=>s.phase=LoginState::Refused,_ if result.is_err()=>s.phase=LoginState::Failed,_=>{}}if result.as_ref().is_err()||result.as_ref().is_ok_and(|v|matches!(v.get("status").and_then(Value::as_str),Some("success"|"expired"|"refused"))){s.qr=None;}result}
async fn check(app:&QqLogin,generation:u64,sig:&str)->Result<Value>{let token=hash33(sig,0).to_string();let res=app.client.get(QR_POLL).query(&[("u1","https://graph.qq.com/oauth2.0/login_jump"),("ptqrtoken",&token),("ptredirect","0"),("h","1"),("t","1"),("g","1"),("from_ui","1"),("ptlang","2052"),("action","0-0-0"),("js_ver","20102616"),("js_type","1"),("pt_uistyle","40"),("aid","716027609"),("daid","383"),("pt_3rd_aid","100497308"),("has_onekey","1")]).header("Cookie",format!("qrsig={sig}")).header("Referer",REFERRER).send().await.map_err(net)?;let body=bytes(res).await?;let (code,params)=qr_poll_result(std::str::from_utf8(&body).map_err(|_|err("upstream","QQ 登录状态格式异常"))?)?;app.current(generation)?;match code{66=>Ok(json!({"status":"waiting"})),67=>Ok(json!({"status":"scanned"})),65=>Ok(json!({"status":"expired"})),0=>{let(uin,sigx)=params.ok_or(err("upstream","QQ 登录状态格式异常"))?;let res=app.client.get(CHECK_SIG).query(&[("uin",uin.as_str()),("pttype","1"),("service","ptqrlogin"),("nodirect","0"),("ptsigx",sigx.as_str()),("s_url","https://graph.qq.com/oauth2.0/login_jump"),("ptlang","2052"),("ptredirect","100"),("aid","716027609"),("daid","383"),("pt_login_type","3"),("pt_3rd_aid","100497308")]).header("Referer",REFERRER).send().await.map_err(net)?;if !res.status().is_success()&&!res.status().is_redirection(){return Err(err("auth","QQ 安全验证未通过"));}let c=cookies(&res,&["p_skey","p_uin","skey","uin"]);let pkey=cookie_value(&c,"p_skey").or_else(||cookie_value(&c,"skey")).ok_or(err("auth","QQ 要求额外安全验证"))?;app.current(generation)?;let cookie=c.iter().map(|(k,v)|format!("{k}={v}")).collect::<Vec<_>>().join("; ");let gtk=hash33(pkey,5381).to_string();let oauth_state:String=rand::thread_rng().sample_iter(&Alphanumeric).take(24).map(char::from).collect();let res=app.client.post(AUTHORIZE).header("Referer",REFERRER).header("Cookie",cookie).form(&[("response_type","code"),("client_id","100497308"),("redirect_uri",REDIRECT),("scope","get_user_info"),("state",oauth_state.as_str()),("from_ptlogin","1"),("src","1"),("update_auth","1"),("openapi","1010_1030"),("g_tk",&gtk)]).send().await.map_err(net)?;if !res.status().is_redirection(){return Err(err("auth","QQ 授权需要额外确认或验证"));}let location=res.headers().get(reqwest::header::LOCATION).and_then(|x|x.to_str().ok()).ok_or(err("auth","QQ 授权响应不完整"))?;let code=oauth_code(location,&oauth_state)?;app.current(generation)?;let cred=api(&app.client,"QQConnectLogin.LoginServer","QQLogin",json!({"code":code}),None).await?;let (account,key)=token_fields(&cred)?;app.current(generation)?;let p=profile(&app.client,&cred).await?;let minimal=json!({"musicid":account,"musickey":key});let secret=Credential::new(serde_json::to_string(&minimal).map_err(|_|err("storage","QQ 凭据编码失败"))?).map_err(|_|err("storage","QQ 凭据不可用"))?;let mut state=app.state()?;if state.generation!=generation{return Err(err("cancelled","QQ 登录已取消"));}if state.qr.as_ref().is_none_or(|q|q.created.elapsed()>TIMEOUT){return Err(err("timeout","QQ 二维码已过期"));}SystemCredentialStore.save(&secret).map_err(|_|err("storage","无法安全保存 QQ 凭据"))?;state.qr=None;Ok(json!({"status":"success","profile":p}))},_=>Ok(json!({"status":"refused"}))}}
#[tauri::command]
pub async fn qq_account(app:State<'_,QqLogin>)->Result<Value>{let generation=app.state()?.generation;let cred=SystemCredentialStore.load().map_err(|_|err("storage","无法读取 QQ 凭据"))?;let Some(cred)=cred else{return Ok(json!({"profile":null}));};let value:Value=serde_json::from_str(cred.expose()).map_err(|_|err("storage","QQ 凭据格式异常"))?;let p=profile(&app.client,&value).await?;app.current(generation)?;Ok(json!({"profile":p}))}
#[tauri::command]
pub fn qq_logout(app:State<'_,QqLogin>)->Result<Value>{let mut s=app.state()?;SystemCredentialStore.clear().map_err(|_|err("storage","无法清除 QQ 凭据"))?;s.generation+=1;s.qr=None;s.busy=false;s.phase=LoginState::Idle;Ok(json!({"localCleared":true,"remoteRevoked":false}))}
#[cfg(test)] mod tests {use super::*;#[test]fn parser_rejects_wrong_origins(){assert_eq!(oauth_code("https://example.invalid/?code=x", "s").unwrap_err().message,"QQ 授权返回未知主机，已停止");assert_eq!(oauth_code("https://graph.qq.com/example?code=x", "s").unwrap_err().message,"QQ 授权返回 graph.qq.com 的其他路径，已停止");assert_eq!(oauth_code("https://graph.qq.com/oauth2.0/show?which=Login", "s").unwrap_err().message,"QQ 要求重新登录，请停止并核对账号安全");assert!(oauth_code("https://y.qq.com/portal/wx_redirect.html?code=abc&state=s", "s").is_ok());assert!(qr_poll_result("ptuiCB('66','0','','','waiting');").is_ok());assert!(qr_poll_result("ptuiCB('0','0','https://example.invalid/?uin=1&ptsigx=x','','');").is_err());}#[test]fn token_validation(){assert!(token_fields(&json!({"musicid":1,"musickey":"abc"})).is_ok());assert!(token_fields(&json!({"musicid":1,"musickey":"a;b"})).is_err());assert!(response_data(json!({"code":0,"req_0":{"code":1}})).is_err());}}

#[cfg(test)]
mod callback_fixtures {
 use super::*;
 #[test] fn callback_requires_exact_origin_unique_state_and_code(){
  let good="https://y.qq.com/portal/wx_redirect.html?code=synthetic&state=synthetic_state";
  assert!(oauth_code(good,"synthetic_state").is_ok());
  for url in [
   "http://y.qq.com/portal/wx_redirect.html?code=x&state=s",
   "https://y.qq.com:444/portal/wx_redirect.html?code=x&state=s",
   "https://user@y.qq.com/portal/wx_redirect.html?code=x&state=s",
   "https://y.qq.com.evil.invalid/portal/wx_redirect.html?code=x&state=s",
   "https://y.qq.com/other?code=x&state=s",
   "https://graph.qq.com/oauth2.0/show?which=Auth&code=x&state=s",
   "https://y.qq.com/portal/wx_redirect.html?code=x&state=wrong",
   "https://y.qq.com/portal/wx_redirect.html?code=x",
   "https://y.qq.com/portal/wx_redirect.html?state=s",
   "https://y.qq.com/portal/wx_redirect.html?code=x&code=y&state=s",
   "https://y.qq.com/portal/wx_redirect.html?code=x&state=s&state=bad",
   "https://y.qq.com/portal/wx_redirect.html?code=x&state=s#fragment",
  ] { assert!(oauth_code(url,"s").is_err()); }
 }
 #[test] fn expired_and_cancelled_qr_sessions_cannot_continue(){
  let app=QqLogin::new();{let mut s=app.state().unwrap();s.generation=7;s.qr=Some(QrSession{signature:"fixture".into(),created:Instant::now()-TIMEOUT-Duration::from_secs(1)});}
  assert_eq!(app.current(7).unwrap_err().kind,"timeout");assert_eq!(app.current(6).unwrap_err().kind,"cancelled");
 }
}

#[cfg(test)]
mod oauth_page_plan_fixtures {
 use super::*;
 #[derive(Debug,PartialEq,Eq)] enum Phase { AwaitingUser, ReadyToExchange, Stop }
 // Offline design fixture only; the production path still stops at the authorization page.
 fn classify(location:&str,state:&str,valid_session:bool)->Phase {
  if !valid_session{return Phase::Stop;}
  let Ok(u)=reqwest::Url::parse(location) else{return Phase::Stop;};
  if u.scheme()!="https"||u.port_or_known_default()!=Some(443)||!u.username().is_empty()||u.password().is_some()||u.fragment().is_some(){return Phase::Stop;}
  if u.host_str()==Some("graph.qq.com")&&u.path()=="/oauth2.0/show"{return Phase::AwaitingUser;}
  if oauth_code(location,state).is_ok(){Phase::ReadyToExchange}else{Phase::Stop}
 }
 #[test] fn interactive_page_is_not_a_successful_callback(){
  let page="https://graph.qq.com/oauth2.0/show?which=synthetic";
  assert_eq!(classify(page,"s",true),Phase::AwaitingUser);
  assert_eq!(classify(page,"s",false),Phase::Stop);
  assert_eq!(classify("https://graph.qq.com/oauth2.0/show.evil?code=fixture&state=s","s",true),Phase::Stop);
  assert_eq!(classify("https://graph.qq.com.evil.invalid/oauth2.0/show?which=synthetic","s",true),Phase::Stop);
 }
 #[test] fn candidate_state_requires_user_then_valid_live_callback(){
  let page="https://graph.qq.com/oauth2.0/show?which=synthetic";
  let callback="https://y.qq.com/portal/wx_redirect.html?code=fixture&state=s";
  let mut phase=classify(page,"s",true);assert_eq!(phase,Phase::AwaitingUser);
  // User action alone cannot yield a code; only the validated final redirect can advance.
  assert_eq!(phase,Phase::AwaitingUser);
  phase=classify(callback,"s",true);assert_eq!(phase,Phase::ReadyToExchange);
  assert_eq!(classify(callback,"s",false),Phase::Stop);
  assert_eq!(classify(callback,"wrong-session",true),Phase::Stop);
 }
 #[test] fn only_a_live_matching_final_callback_can_advance(){
  let callback="https://y.qq.com/portal/wx_redirect.html?code=fixture&state=s";
  assert_eq!(classify(callback,"s",true),Phase::ReadyToExchange);
  assert_eq!(classify(callback,"s",false),Phase::Stop);
  assert_eq!(classify(callback,"different",true),Phase::Stop);
  assert_eq!(classify("https://y.qq.com/portal/wx_redirect.html?code=fixture&state=s&state=s","s",true),Phase::Stop);
 }
}
