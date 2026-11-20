use serde::{Deserialize,Serialize};
use std::{fs,io::Read};
use tauri::{App,Manager,PhysicalPosition,PhysicalSize,WindowEvent};
#[derive(Serialize,Deserialize,Clone,Debug,PartialEq)]
#[serde(deny_unknown_fields)]
struct Geometry{version:u8,x:i32,y:i32,width:u32,height:u32,#[serde(default)] maximized:bool}
#[derive(Clone,Copy)] struct Area{x:i32,y:i32,width:u32,height:u32}
fn fit(g:&Geometry,areas:&[Area])->Option<Geometry>{
 if g.version!=1||g.width<320||g.height<240||g.width>16384||g.height>16384{return None}
 let (x,y,w)=(g.x as i64,g.y as i64,g.width as i64);
 let area=areas.iter().find(|a|{let (ax,ay,aw,ah)=(a.x as i64,a.y as i64,a.width as i64,a.height as i64);let overlap=(x+w).min(ax+aw)-x.max(ax);let title=(y+64).min(ay+ah)-y.max(ay);overlap>=128&&title>=32})?;
 let width=g.width.min(area.width);let height=g.height.min(area.height);if width<320||height<240{return None}
 let max_x=area.x as i64+area.width as i64-width as i64;let max_y=area.y as i64+area.height as i64-height as i64;
 Some(Geometry{version:1,x:x.clamp(area.x as i64,max_x) as i32,y:y.clamp(area.y as i64,max_y) as i32,width,height,maximized:g.maximized})
}

pub fn install(app:&mut App){
 let Some(window)=app.get_webview_window("main") else{return};let Ok(dir)=app.path().app_data_dir() else{return};let path=dir.join("window-state.json");
 if let Ok(file)=fs::File::open(&path){let mut bytes=Vec::new();if file.take(4097).read_to_end(&mut bytes).is_ok()&&bytes.len()<=4096{if let Ok(g)=serde_json::from_slice::<Geometry>(&bytes){if let Ok(monitors)=window.available_monitors(){let areas:Vec<Area>=monitors.iter().map(|m|{let r=m.work_area();Area{x:r.position.x,y:r.position.y,width:r.size.width,height:r.size.height}}).collect();if let Some(g)=fit(&g,&areas){let _=window.set_size(PhysicalSize::new(g.width,g.height));let _=window.set_position(PhysicalPosition::new(g.x,g.y));if g.maximized{let _=window.maximize();}}}}}}
 let w=window.clone();window.on_window_event(move|event|{if !matches!(event,WindowEvent::CloseRequested{..})||w.is_minimized().unwrap_or(true){return}if let (Ok(p),Ok(size))=(w.outer_position(),w.inner_size()){let g=Geometry{version:1,x:p.x,y:p.y,width:size.width,height:size.height,maximized:w.is_maximized().unwrap_or(false)};if let Ok(raw)=serde_json::to_vec(&g){let _=crate::playback_storage::write_if_changed(&path,&raw);}}});
}
#[cfg(test)]mod tests{use super::*;#[test]fn rejects_offscreen_and_invalid_geometry(){let a=[Area{x:0,y:0,width:1920,height:1040},Area{x:-1280,y:0,width:1280,height:1000}];let mut g=Geometry{version:1,x:-1200,y:30,width:900,height:700,maximized:false};assert!(fit(&g,&a).is_some());g.x=3000;assert!(fit(&g,&a).is_none());g.x=10;g.y=-100;assert!(fit(&g,&a).is_none());g.y=10;g.width=0;assert!(fit(&g,&a).is_none());g.width=6000;assert!(fit(&g,&a).unwrap().width<=1920);g.version=2;assert!(fit(&g,&a).is_none());assert!(serde_json::from_str::<Geometry>("{").is_err());}}
