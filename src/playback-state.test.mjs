import test from 'node:test';import assert from 'node:assert/strict';import {makePlaybackState,restorePlaybackState,makeQqPlaybackState,restoreQqPlaybackState,nextIndex,coverForStorage,reorderQueueTracks,computePlayNextTarget} from './playback-state.js';
const track={id:12,name:'合成歌曲',ar:[{name:'合成歌手'}],al:{name:'合成专辑',picUrl:'https://example.invalid/private'},url:'https://example.invalid/audio?token=secret',cookie:'secret',dt:120000,provider:'netease',accountId:1};
const queue={tracks:[track],index:0,source:'playlist'};
test('只保存白名单，恢复时拒绝不同平台和账号',()=>{const s=makePlaybackState({accountId:1,normalQueue:queue,fmQueue:null,current:{provider:'netease',kind:'normal',index:0,position:17},mode:'shuffle',volume:.4,muted:true});assert(!JSON.stringify(s).includes('https'));assert(!JSON.stringify(s).includes('secret'));assert.equal(restorePlaybackState(s,2),null);assert.equal(restorePlaybackState({...s,provider:'qqmusic'},1),null);const r=restorePlaybackState(s,1);assert.equal(r.normalQueue.tracks[0].name,'合成歌曲');assert.equal(r.current.position,17);assert.equal(r.mode,'shuffle');assert.equal(r.muted,true);});
test('FM 与普通队列独立，单曲与随机模式可用',()=>{const s=makePlaybackState({accountId:1,normalQueue:queue,fmQueue:{...queue,source:'fm'},current:{provider:'netease',kind:'fm',index:0,position:1},mode:'repeat-one',volume:1,muted:false});assert.equal(s.normalQueue.source,'playlist');assert.equal(s.fmQueue.source,'fm');assert.equal(s.current.kind,'fm');assert.equal(nextIndex('repeat-one',0,2),0);assert.equal(nextIndex('shuffle',0,2,()=>0),1);assert.equal(nextIndex('sequential',1,2),-1);});
test('QQ 队列使用单独平台与账号，保留安全专辑封面且不持久化地址或凭据',()=>{const q={source:'playlist',index:0,tracks:[{...track,id:'MID1',mediaMid:'FILE1',album:{name:'合成专辑',picUrl:'http://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg'}}]};const state=makeQqPlaybackState({accountId:1,queue:q,position:9,mode:'shuffle',volume:.5,muted:false});assert(!JSON.stringify(state).includes('secret'));assert.equal(state.queue.tracks[0].coverUrl,'https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg');assert.equal(restoreQqPlaybackState(state,2),null);const restored=restoreQqPlaybackState(state,1);assert.equal(restored.queue.tracks[0].mediaMid,'FILE1');assert.equal(restored.queue.tracks[0].album.picUrl,'https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg');assert.equal(restorePlaybackState(state,1),null);assert.throws(()=>makeQqPlaybackState({accountId:1,queue:{...q,tracks:[{...q.tracks[0],id:'https://bad'}]}}));const unsafe={source:'playlist',index:0,tracks:[{...track,id:'MID2',album:{name:'合成',picUrl:'https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg?token=secret'}}]};assert.equal(makeQqPlaybackState({accountId:1,queue:unsafe}).queue.tracks[0].coverUrl,undefined);});
test('私人 FM 仅保存受限的无参数网易封面并在恢复时保留',()=>{
 const fmTrack={...track,album:{name:'专辑',picUrl:'http://p1.music.126.net/Ab_c-1==/109951168912345678.jpg'}};
 const fm={tracks:[fmTrack],index:0,source:'fm'};
 const state=makePlaybackState({accountId:1,fmQueue:fm,current:{provider:'netease',kind:'fm',index:0,position:1},mode:'sequential',volume:1,muted:false});
 assert.equal(state.fmQueue.tracks[0].coverUrl,'https://p1.music.126.net/Ab_c-1==/109951168912345678.jpg');
 assert.equal(restorePlaybackState(state,1).fmQueue.tracks[0].album.picUrl,state.fmQueue.tracks[0].coverUrl);
 assert(!JSON.stringify(state).includes('secret'));
 for(const url of ['https://p1.music.126.net/Ab/123.jpg?token=secret','https://evil.invalid/Ab/123.jpg']){fmTrack.album.picUrl=url;assert.equal(makePlaybackState({accountId:1,fmQueue:fm}).fmQueue.tracks[0].coverUrl,undefined);}
});

test('普通队列封面仅保留安全尺寸参数并自动升级 http',()=>{const s={album:{picUrl:'http://p1.music.126.net/img/1.jpg?token=synthetic&param=300y300'}};assert.equal(coverForStorage(s),'https://p1.music.126.net/img/1.jpg?param=300y300');s.album.picUrl='https://p1.music.126.net/img/1.jpg?param=secret';assert.equal(coverForStorage(s),'https://p1.music.126.net/img/1.jpg');s.album.picUrl='https://other.invalid/img.jpg?param=300y300';assert.equal(coverForStorage(s),null);});

test('reorderQueueTracks 与 computePlayNextTarget 精准重算队列顺序与当前播放索引', () => {
  const tracks = ['A', 'B', 'C', 'D'];
  // 拖动当前正在播的 B(1) 到 D(3) 的位置
  const moveCurrent = reorderQueueTracks(tracks, 1, 1, 3);
  assert.deepEqual(moveCurrent, { tracks: ['A', 'C', 'D', 'B'], index: 3 });

  // 把当前 B(1) 之后的 D(3) 拖到 A(0) 前，当前索引应右移至 2
  const moveAfterToBefore = reorderQueueTracks(tracks, 1, 3, 0);
  assert.deepEqual(moveAfterToBefore, { tracks: ['D', 'A', 'B', 'C'], index: 2 });

  // 把当前 C(2) 之前的 A(0) 拖到 D(3) 后，当前索引应左移至 1
  const moveBeforeToAfter = reorderQueueTracks(tracks, 2, 0, 3);
  assert.deepEqual(moveBeforeToAfter, { tracks: ['B', 'C', 'D', 'A'], index: 1 });

  // 边界与非法输入
  assert.equal(reorderQueueTracks(tracks, 0, 1, 1), null);
  assert.equal(reorderQueueTracks(['A'], 0, 0, 0), null);
  assert.equal(reorderQueueTracks(tracks, 0, -1, 2), null);

  // computePlayNextTarget：当前播放 C(2)
  assert.equal(computePlayNextTarget(2, 2, 4), -1);
  assert.equal(computePlayNextTarget(2, 3, 4), -1);
  assert.equal(computePlayNextTarget(2, 0, 4), 2);
  const putBeforeAsNext = reorderQueueTracks(tracks, 2, 0, computePlayNextTarget(2, 0, 4));
  assert.deepEqual(putBeforeAsNext, { tracks: ['B', 'C', 'A', 'D'], index: 1 });

  // 当前播放 A(0)，把 D(3) 设为下一首
  assert.equal(computePlayNextTarget(0, 3, 4), 1);
  const putAfterAsNext = reorderQueueTracks(tracks, 0, 3, computePlayNextTarget(0, 3, 4));
  assert.deepEqual(putAfterAsNext, { tracks: ['A', 'D', 'B', 'C'], index: 0 });
});
