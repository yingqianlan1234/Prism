// In-memory observation only: there is no transport, retry or persistence.
export class ListeningTracker {
 constructor(){this.session=null;this.nextSessionId=0;this.reportingAllowed=false;this.diagnosticsEnabled=false;}
 setDiagnosticsEnabled(value){this.diagnosticsEnabled=value===true;const s=this.session;if(s)s.diagnostic=this.diagnosticsEnabled?{baseSeconds:s.seconds,mediaSeconds:0,pauses:0,buffering:0,seeks:0}:null;}
 setReportingAllowed(value){this.reportingAllowed=value===true;if(!this.reportingAllowed&&this.session)this.session.reportEligible=false;}
 start({provider,accountId,trackId,source='unknown'}){this.session={sessionId:++this.nextSessionId,provider,accountId,trackId,source,seconds:0,anchor:null,running:false,settled:false,reportEligible:this.reportingAllowed,diagnostic:this.diagnosticsEnabled?{baseSeconds:0,mediaSeconds:0,pauses:0,buffering:0,seeks:0}:null};}
 clear(){this.session=null;}
 resume(position,now,rate=1){const s=this.session;if(!s)return;if(!Number.isFinite(position)||!Number.isFinite(now)||!Number.isFinite(rate)||rate<=0){s.running=false;s.anchor=null;return;}s.anchor={position,now,rate};s.running=true;}
 interrupt(kind){const s=this.session;if(s){if(s.diagnostic){if(kind==='pause')s.diagnostic.pauses++;if(kind==='buffering')s.diagnostic.buffering++;if(kind==='seek')s.diagnostic.seeks++;}s.running=false;s.anchor=null;}}
 progress(position,now,rate=1){const s=this.session;if(!s||!s.running)return;const a=s.anchor;if(!Number.isFinite(position)||!Number.isFinite(now)||!Number.isFinite(rate)||rate<=0){this.interrupt();return;}s.anchor={position,now,rate};if(!a||a.rate!==rate)return;const wall=(now-a.now)/1000,media=position-a.position;if(wall<=0||wall>5||media<=0||media>wall*rate+0.25)return;s.seconds+=Math.min(wall,media/rate);if(s.diagnostic)s.diagnostic.mediaSeconds+=media;}
 diagnosticSnapshot(){const s=this.session,d=s?.diagnostic;if(!d)return null;return {sessionId:s.sessionId,mediaSeconds:d.mediaSeconds,validSeconds:Math.max(0,s.seconds-d.baseSeconds),pauses:d.pauses,buffering:d.buffering,seeks:d.seeks,thresholdReached:s.seconds>=30};}
 snapshot(){const s=this.session;return s?{sessionId:s.sessionId,provider:s.provider,accountId:s.accountId,trackId:s.trackId,seconds:s.seconds}:null;}
 settle(){const s=this.session;if(!s||s.settled)return null;s.settled=true;this.interrupt();if(!this.reportingAllowed||!s.reportEligible||!s.accountId||s.provider!=='netease'||s.seconds<30)return null;return this.snapshot();}
}
