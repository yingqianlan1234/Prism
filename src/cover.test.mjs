import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistCoverUrl,artworkUrl,songAlbum} from './cover.js';
test('歌单封面仅升级可信网易图片并拒绝不安全地址',()=>{
 assert.equal(playlistCoverUrl('http://p1.music.126.net/example.jpg?x=1'),'https://p1.music.126.net/example.jpg?x=1');
 assert.equal(playlistCoverUrl('https://p1.music.126.net/example.jpg'),'https://p1.music.126.net/example.jpg');
 for(const value of ['http://example.invalid/image','javascript:alert(1)','https://user:pass@example.invalid/image',null,'']) assert.equal(playlistCoverUrl(value),null);
});
test('歌曲封面保留已有参数并兼容专辑字段',()=>{
 assert.equal(artworkUrl('http://p1.music.126.net/test.jpg',80),'https://p1.music.126.net/test.jpg?param=80y80');
 assert.equal(artworkUrl('https://p1.music.126.net/test.jpg?token=abc',80),'https://p1.music.126.net/test.jpg?token=abc');
 assert.equal(artworkUrl('https://y.gtimg.cn/test.jpg',80),'https://y.gtimg.cn/test.jpg');
 assert.equal(artworkUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg',80),'https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg');
 assert.equal(artworkUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg',500),'https://y.gtimg.cn/music/photo_new/T002R500x500M000ALB1.jpg');
 assert.equal(artworkUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg',800),'https://y.gtimg.cn/music/photo_new/T002R800x800M000ALB1.jpg');
 assert.equal(artworkUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg?token=1',500),'https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg?token=1');
 assert.equal(songAlbum({album:{name:'合成'},al:{picUrl:'http://p1.music.126.net/test.jpg'}}).picUrl,'http://p1.music.126.net/test.jpg');
});
test('内嵌封面 data URI 仅放行安全栅格图并拒绝矢量和异常地址',()=>{
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
 const jpg='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
 const webp='data:image/webp;base64,UklGRh4AAABXRUJQVlA4';
 assert.equal(artworkUrl(png,500),png);
 assert.equal(artworkUrl(jpg,80),jpg);
 assert.equal(artworkUrl(webp,800),webp);
 for(const bad of [
  'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  'data:text/html;base64,PHNjcmlwdD4=',
  'data:image/png;base64,not-valid!@#',
  'data:image/png;utf8,raw',
  `data:image/png;base64,${'A'.repeat(3_000_005)}`,
 ]){
  assert.equal(artworkUrl(bad,500),null);
 }
});

