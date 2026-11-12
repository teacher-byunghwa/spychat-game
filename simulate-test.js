// Dependency-free Socket.IO event-logic simulation. Not a network/browser load test.
const fs=require('fs'), vm=require('vm'), assert=require('assert'), EventEmitter=require('events');
class FakeSocket {constructor(io){this.io=io;this.id='socket'+(++io.next);this.handlers={};this.events=[];this.data={};io.sockets.sockets.set(this.id,this)} on(n,fn){this.handlers[n]=fn} emit(n,data){this.events.push({name:n,data})} join(g){(this.io.groups[g]??=new Set()).add(this.id)} disconnect(){this.io.sockets.sockets.delete(this.id)} send(n,data){let ack;this.handlers[n]?.(data,a=>ack=a);return ack} last(n){return [...this.events].reverse().find(e=>e.name===n)?.data}}
class FakeIO {constructor(){this.next=0;this.groups={};this.sockets={sockets:new Map()}} on(n,cb){if(n==='connection')this.connectFn=cb} connect(){const s=new FakeSocket(this);this.connectFn(s);return s} to(target){return {emit:(n,data)=>{const members=this.groups[target]||new Set([target]);for(const id of members)this.sockets.sockets.get(id)?.emit(n,data)}}}}
const io=new FakeIO();let serverListen=false;
const mocks={express:()=>{const f=(req,res)=>{};f.disable=()=>{};f.use=()=>{};f.get=()=>{};return f},http:{createServer:()=>({listen:()=>{serverListen=true}})},'socket.io':{Server:class {constructor(){return io}}},qrcode:{toBuffer:async()=>Buffer.alloc(0)}};mocks.express.static=()=>()=>{};
const fakeTimers=new Map();let nextTimer=0;function fakeSetTimeout(fn){const id=++nextTimer;fakeTimers.set(id,fn);return id;}function fakeClearTimeout(id){fakeTimers.delete(id);}
const context={setTimeout:fakeSetTimeout,clearTimeout:fakeClearTimeout,require:id=>mocks[id]||require(id),console,process:{env:{PORT:'3100'}},Buffer,Map,Set,Date,Number,String,encodeURIComponent};
vm.runInNewContext(fs.readFileSync(__dirname+'/server.js','utf8'),context,{filename:'server.js'});
assert(serverListen);
let total=0;
function check(ok,msg){assert(ok,msg);total++}
function setup(count,spies=3){const teacher=io.connect();const created=teacher.send('room:create',{});check(created?.ok,'create room');const students=[];for(let i=0;i<count;i++){const s=io.connect();const joined=s.send('student:join',{code:created.code,name:'학생'+i});check(joined?.ok,'join '+i);students.push({s,...joined})}const start=teacher.send('teacher:action',{code:created.code,token:created.token,action:'start',payload:{word:'놀이공원',spyCount:spies}});check(start?.ok,'start');return {teacher,created,students,code:created.code,teacherToken:created.token}}
const a=setup(35,6);const roles=a.students.map(p=>p.s.last('student:state').you.role);check(roles.filter(x=>x==='spy').length===6,'spy count');check(a.students.filter((p,i)=>roles[i]==='spy').every(p=>!p.s.last('student:state').you.word),'spy cannot see word');check(a.students.filter((p,i)=>roles[i]==='student').every(p=>p.s.last('student:state').you.word==='놀이공원'),'civilian knows word');
const civilian=a.students.find((p,i)=>roles[i]==='student');const spy=a.students.find((p,i)=>roles[i]==='spy');let targetId=spy.s.last('student:state').you.id;
let res=civilian.s.send('student:challenge',{code:a.code,token:civilian.token,targetId});check(res?.ok,'civilian successfully challenges');
check(spy.s.last('student:state').you.out,'spy eliminated');check(civilian.s.last('student:state').you.score===0,'civilian reward deferred');let popup=civilian.s.last('challenge:announcement');check(popup.message.includes('스파이'),'public popup');check(!popup.message.includes(civilian.name),'challenger identity not shown in popup');
const wrongTarget=a.students.find(p=>p!==civilian && p.s.last('student:state').you.role==='student');const wrongChallenger=a.students.find(p=>p!==civilian&&p!==wrongTarget&&p.s.last('student:state').you.role==='student');res=wrongChallenger.s.send('student:challenge',{code:a.code,token:wrongChallenger.token,targetId:wrongTarget.s.last('student:state').you.id});check(res?.ok,'wrong civilian challenge accepted');check(wrongChallenger.s.last('student:state').you.out,'wrong challenger out');check(!wrongTarget.s.last('student:state').you.out,'wrongly accused stays');check(wrongChallenger.s.last('challenge:announcement').message.includes(wrongChallenger.name),'wrong challenger named');
const survivingSpy=a.students.find(p=>p.s.last('student:state').you.role==='spy'&&!p.s.last('student:state').you.out);res=survivingSpy.s.send('student:challenge',{code:a.code,token:survivingSpy.token,word:'놀이공원'});check(res?.ok,'spy guesses word');check(survivingSpy.s.last('student:state').you.score===2,'guessing spy +2');check(spy.s.last('student:state').you.score===1,'eliminated spy +1');check(civilian.s.last('student:state').you.score===1,'deferred civilian +1');check(!!a.teacher.last('teacher:state').result.leaderboard,'leaderboard');
const b=setup(30,4);const lead=b.teacher.last('teacher:state');check(lead.players.length===30,'30 students');check(lead.connectedCount===30,'30 simulated connections');const turn=b.students.find(p=>p.s.last('student:state').turnId===p.s.last('student:state').you.id);res=turn.s.send('student:clue',{code:b.code,token:turn.token,text:'정말 재미있어요'});check(res?.ok,'clue submission');check(b.students.every(p=>p.s.last('student:state').highlight?.text==='정말 재미있어요'),'clue broadcast');res=b.teacher.send('teacher:action',{code:b.code,token:b.teacherToken,action:'pause'});check(res?.ok,'pause');check(b.teacher.last('teacher:state').paused,'paused state');
console.log('PASS '+total+' simulated assertions; 65 student socket objects across two rooms. This is not a real TCP/WebSocket concurrency test.');
// V6: finishing explanations starts a 60-second guessing period, not instant victory.
const c=setup(5,2);
const cRoles=c.students.map(p=>p.s.last('student:state').you.role);
check(c.students.filter((p,i)=>cRoles[i]==='spy').every(p=>p.s.last('student:state').you.word===null),'spy word never exposed');
for(let i=0;i<5;i++){
 const state=c.teacher.last('teacher:state');check(state.phase==='playing','still playing before clue '+i);
 const speaker=c.students.find(p=>p.s.last('student:state').you.id===state.turnId);
 check(speaker?.s.send('student:clue',{code:c.code,token:speaker.token,text:'설명 '+i})?.ok,'clue '+i);
}
let state=c.teacher.last('teacher:state');
check(state.phase==='final_guess','final guess phase after final clue');
check(state.finalGuessDeadline>state.serverTime,'final guess deadline set');
check(c.students.every(p=>p.s.last('student:state').you.score===0),'no premature reward');
const citizen=c.students.find((p,i)=>cRoles[i]==='student');
const spy2=c.students.find((p,i)=>cRoles[i]==='spy');
check(!citizen.s.send('student:challenge',{code:c.code,token:citizen.token,targetId:spy2.s.last('student:state').you.id})?.ok,'civilian cannot challenge during final guess');
check(spy2.s.send('student:challenge',{code:c.code,token:spy2.token,word:'놀이공원'})?.ok,'spy can solve during final guess');
check(c.teacher.last('teacher:state').phase==='finished','correct final guess ends round');
check(spy2.s.last('student:state').you.score===2,'correct spy +2');
check(c.students.filter((p,i)=>cRoles[i]==='student').every(p=>p.s.last('student:state').you.score===0),'civilians do not win on correct final guess');
const d=setup(4,1);const dRoles=d.students.map(p=>p.s.last('student:state').you.role);
const innocent=d.students.find((p,i)=>dRoles[i]==='student');
const otherInnocent=d.students.find((p,i)=>dRoles[i]==='student'&&p!==innocent);
check(innocent.s.send('student:challenge',{code:d.code,token:innocent.token,targetId:otherInnocent.s.last('student:state').you.id})?.ok,'wrong civilian challenge');
while(d.teacher.last('teacher:state').phase==='playing'){
 const st=d.teacher.last('teacher:state');const speaker=d.students.find(p=>p.s.last('student:state').you.id===st.turnId);
 check(speaker.s.send('student:clue',{code:d.code,token:speaker.token,text:'다양한 설명'})?.ok,'remaining clue');
}
check(d.teacher.last('teacher:state').phase==='final_guess','final phase on reduced active players');
check(d.teacher.send('teacher:action',{code:d.code,token:d.teacherToken,action:'pause'})?.ok,'pause final timer');
check(d.teacher.last('teacher:state').paused,'final phase paused');
check(d.teacher.last('teacher:state').finalGuessDeadline===null,'deadline cleared while paused');
check(d.teacher.send('teacher:action',{code:d.code,token:d.teacherToken,action:'pause'})?.ok,'resume final timer');
check(d.teacher.last('teacher:state').finalGuessDeadline>0,'timer resumed');
for(const fn of [...fakeTimers.values()]){fn();}
check(d.teacher.last('teacher:state').phase==='finished','timer expiry ends round');
check(d.teacher.last('teacher:state').result.message.includes('일반학생팀 승리'),'civilian victory message');
check(d.students.filter((p,i)=>dRoles[i]==='student').every(p=>p.s.last('student:state').you.score===1),'all civilians including eliminated +1');
console.log('PASS '+total+' simulated assertions including 60-second final phase, spy guess, pause, and time expiry. Not a real network load test.');
// V7: separate, role-neutral conversation channel.
const e=setup(4,1);
const chatter=e.students[0];
const other=e.students[1];
let chatAck=chatter.s.send('student:chat',{code:e.code,token:chatter.token,text:'안녕! 다들 어떻게 생각해?'});
check(chatAck?.ok,'casual chat accepted outside description turn');
const publicChat=other.s.last('student:state').chat;
check(publicChat.length===1&&publicChat[0].text==='안녕! 다들 어떻게 생각해?','chat visible to everyone');
check(e.teacher.last('teacher:state').chat.length===1,'teacher sees chat');
check(!('role' in publicChat[0])&&!('word' in publicChat[0]),'chat contains no role metadata');
check(!b.teacher.last('teacher:state').chat?.length,'another room does not receive messages');
check(!chatter.s.send('student:chat',{code:e.code,token:chatter.token,text:'너무 빠른 두 번째 메시지'})?.ok,'chat rate limited');
check(e.teacher.send('teacher:action',{code:e.code,token:e.teacherToken,action:'pause'})?.ok,'teacher pauses chat round');
check(!other.s.send('student:chat',{code:e.code,token:other.token,text:'일시정지 동안 차단'})?.ok,'chat blocked while paused');
check(e.teacher.send('teacher:action',{code:e.code,token:e.teacherToken,action:'pause'})?.ok,'teacher resumes chat round');
check(other.s.send('student:chat',{code:e.code,token:other.token,text:'다시 대화해요'})?.ok,'chat restored after resume');
check(e.teacher.send('teacher:action',{code:e.code,token:e.teacherToken,action:'stop'})?.ok,'end round');
check(!other.s.send('student:chat',{code:e.code,token:other.token,text:'종료 후 메시지'})?.ok,'chat disabled after finish');
console.log('PASS '+total+' simulated assertions including V7 room-isolated casual chat. Not a real network/browser load test.');
// V8 regression: finding the final spy awards each civilian +1 (including out),
// while the anonymous successful challenger receives the deferred +1 separately.
const f=setup(5,1);
const fSpy=f.students.find(p=>p.s.last('student:state').you.role==='spy');
const fCivilians=f.students.filter(p=>p.s.last('student:state').you.role==='student');
const fSpyId=fSpy.s.last('student:state').you.id;
const fCivIds=fCivilians.map(p=>p.s.last('student:state').you.id);
check(fCivilians[0].s.send('student:challenge',{code:f.code,token:fCivilians[0].token,targetId:fCivIds[1]})?.ok,'v8 wrong civilian guess accepted');
check(fCivilians[0].s.last('student:state').you.out,'v8 incorrectly guessing civilian eliminated');
check(fCivilians[2].s.send('student:challenge',{code:f.code,token:fCivilians[2].token,targetId:fSpyId})?.ok,'v8 final spy found');
const fFinished=f.teacher.last('teacher:state');
check(fFinished.phase==='finished'&&fFinished.result.winner==='student','v8 elimination victory');
check(fCivilians.every((p,i)=>p.s.last('student:state').you.score===(i===2?2:1)),'v8 all civilians +1 incl eliminated, challenger additionally +1');
check(fSpy.s.last('student:state').you.score===0,'v8 spy gets no bonus');
check(fFinished.result.leaderboard.filter(p=>fCivIds.includes(p.id)).every(p=>p.teamBonus===1),'v8 ranking indicates +1 team reward');
check(f.teacher.send('teacher:action',{code:f.code,token:f.teacherToken,action:'start',payload:{word:'학교',spyCount:1}})?.ok,'v8 second round');
check(fCivilians.every((p,i)=>p.s.last('student:state').you.score===(i===2?2:1)),'v8 score persists after start of next round');
console.log('PASS '+total+' simulated assertions including V8 civilian team award and leaderboard.');
// V9 regression: elimination broadcasts identify ONLY the real participant,
// never a fixed sample name; teacher can start an entirely new scoreboard.
const g=setup(5,2);
const gCiv=g.students.filter(p=>p.s.last('student:state').you.role==='student');
const gSpy=g.students.filter(p=>p.s.last('student:state').you.role==='spy');
const gCivId=p=>p.s.last('student:state').you.id;
check(gCiv[0].s.send('student:challenge',{code:g.code,token:gCiv[0].token,targetId:gCivId(gCiv[1])})?.ok,'v9 wrong guess submitted');
let gPopup=g.teacher.last('challenge:announcement');
check(gPopup.type==='student-out'&&gPopup.eliminatedId===gCivId(gCiv[0]),'v9 failed guess names the challenger ID');
check(gPopup.eliminatedName===gCiv[0].name&&gPopup.message.includes(gCiv[0].name),'v9 failed guess names real challenger');
check(!gPopup.message.includes('민준')&&!gPopup.message.includes(gCiv[1].name),'v9 no sample or innocent target name');
check(gCiv[2].s.send('student:challenge',{code:g.code,token:gCiv[2].token,targetId:gCivId(gSpy[0])})?.ok,'v9 real spy identified');
gPopup=g.teacher.last('challenge:announcement');
check(gPopup.eliminatedId===gCivId(gSpy[0])&&gPopup.eliminatedName===gSpy[0].name,'v9 identified spy actual ID/name');
check(!gPopup.message.includes(gCiv[2].name),'v9 successful challenger still anonymous');
check(gSpy[1].s.send('student:challenge',{code:g.code,token:gSpy[1].token,word:'오답'})?.ok,'v10 first incorrect spy guess');
check(!gSpy[1].s.last('student:state').you.out,'v10 spy survives first wrong guess');
check(gSpy[1].s.last('student:state').you.spyGuessAttempts===1,'v10 private guess counter increments');
check(g.teacher.last('challenge:announcement').eliminatedId!==gCivId(gSpy[1]),'v10 no public identity reveal on first incorrect guess');
check(gSpy[1].s.send('student:challenge',{code:g.code,token:gSpy[1].token,word:'또오답'})?.ok,'v10 second incorrect spy guess');
gPopup=g.teacher.last('challenge:announcement');
check(gPopup.eliminatedId===gCivId(gSpy[1])&&gPopup.eliminatedName===gSpy[1].name,'v9 incorrect guessing spy actual ID/name');
check(g.teacher.last('teacher:state').phase==='finished','v9 all spies out finishes');
check(g.teacher.send('teacher:action',{code:g.code,token:g.teacherToken,action:'new_game'})?.ok,'v9 teacher reset accepted');
const gReset=g.teacher.last('teacher:state');
check(gReset.phase==='lobby'&&gReset.round===0&&gReset.gameVersion===2,'v9 reset and new role reveal epoch');
check(gReset.code===g.code&&gReset.players.length===5,'v9 room code and participants preserved');
check(gReset.players.every(p=>p.score===0&&!p.out),'v9 scores reset and participants restored');
check(gReset.result===null,'v9 old round result removed');
check(g.teacher.send('teacher:action',{code:g.code,token:g.teacherToken,action:'start',payload:{word:'새제시어',spyCount:1}})?.ok,'v9 start a new game after reset');
check(g.teacher.last('teacher:state').round===1&&g.teacher.last('teacher:state').phase==='playing','v9 first round of new game');
check(!g.teacher.send('teacher:action',{code:g.code,token:g.teacherToken,action:'new_game'})?.ok,'v9 reset blocked during active round');
console.log('PASS '+total+' simulated assertions including V9 actual elimination identity and new game reset.');

// V10: one private miss followed by correct answer; attempts reset next round.
const h=setup(5,2);
const hSpy=h.students.find(p=>p.s.last('student:state').you.role==='spy');
const hSpyState=()=>hSpy.s.last('student:state').you;
const hPopupCount=()=>h.teacher.events.filter(e=>e.name==='challenge:announcement').length;
const hPopups=hPopupCount();
check(hSpy.s.send('student:challenge',{code:h.code,token:hSpy.token,word:'버스'})?.ok,'v10 first private miss acknowledged');
check(!hSpyState().out&&hSpyState().spyGuessAttempts===1,'v10 first miss retains spy and one chance');
check(hPopupCount()===hPopups,'v10 first miss not announced to room');
check(hSpy.s.last('challenge:feedback').message.includes('남은 기회 1회'),'v10 only the spy sees remaining attempts');
check(!h.teacher.last('teacher:state').players.some(p=>'spyGuessAttempts' in p),'v10 attempts not visible on public participant list');
check(hSpy.s.send('student:challenge',{code:h.code,token:hSpy.token,word:'놀이공원'})?.ok,'v10 correct second attempt');
check(h.teacher.last('teacher:state').phase==='finished','v10 correct second attempt wins');
check(hSpyState().score===2,'v10 correct second attempt gets 2 points');
check(h.teacher.send('teacher:action',{code:h.code,token:h.teacherToken,action:'start',payload:{word:'새제시어',spyCount:2}})?.ok,'v10 next round starts');
check(h.students.filter(p=>p.s.last('student:state').you.role==='spy').every(p=>p.s.last('student:state').you.spyGuessAttempts===0),'v10 spy attempts reset to zero each round');
// The 60-second final phase does not give additional attempts beyond two.
const j=setup(4,1);
const jSpy=j.students.find(p=>p.s.last('student:state').you.role==='spy');
check(jSpy.s.send('student:challenge',{code:j.code,token:jSpy.token,word:'아님'})?.ok,'v10 first miss before final phase');
while(j.teacher.last('teacher:state').phase==='playing'){const st=j.teacher.last('teacher:state');const speaker=j.students.find(p=>p.s.last('student:state').you.id===st.turnId);check(speaker.s.send('student:clue',{code:j.code,token:speaker.token,text:'설명 입력'})?.ok,'v10 clue until final phase');}
check(j.teacher.last('teacher:state').phase==='final_guess','v10 final phase starts');
check(jSpy.s.send('student:challenge',{code:j.code,token:jSpy.token,word:'또아님'})?.ok,'v10 second miss in final phase');
check(jSpy.s.last('student:state').you.out,'v10 eliminated on second miss across phases');
check(j.teacher.last('teacher:state').result.winner==='student','v10 last spy out awards students victory');
console.log('PASS '+total+' simulated assertions including V10 two spy guess attempts.');

// V11: manual selection is validated before round state changes; private teammate list.
const k=setup(6,2);
const kSpies=k.students.filter(p=>p.s.last('student:state').you.role==='spy');
const kCivs=k.students.filter(p=>p.s.last('student:state').you.role==='student');
check(kSpies.every(p=>p.s.last('student:state').you.spyTeammates.length===1),'v11 spies privately see one other spy');
check(kSpies[0].s.last('student:state').you.spyTeammates[0].id===kSpies[1].s.last('student:state').you.id,'v11 teammate identity correct');
check(kCivs.every(p=>p.s.last('student:state').you.spyTeammates.length===0),'v11 civilians never receive spy teammate list');
check(!('spyTeammates' in k.teacher.last('teacher:state').players[0]),'v11 no teammate list in public roster');
// Finish first round and ask the teacher to manually choose two actual players.
check(k.teacher.send('teacher:action',{code:k.code,token:k.teacherToken,action:'stop'})?.ok,'v11 teacher can end round');
const invalidIds=[k.students[0].s.last('student:state').you.id];
const phaseBefore=k.teacher.last('teacher:state').phase;
check(!k.teacher.send('teacher:action',{code:k.code,token:k.teacherToken,action:'start',payload:{word:'새 단어',spyCount:2,spyMode:'manual',spyIds:invalidIds}})?.ok,'v11 rejects wrong number of manual spies');
check(k.teacher.last('teacher:state').phase===phaseBefore,'v11 rejected assignment does not change phase');
const selection=[k.students[1].s.last('student:state').you.id,k.students[4].s.last('student:state').you.id];
check(!k.teacher.send('teacher:action',{code:k.code,token:k.teacherToken,action:'start',payload:{word:'새 단어',spyCount:2,spyMode:'manual',spyIds:[selection[0],selection[0]]}})?.ok,'v11 rejects duplicate selected spy');
check(k.teacher.send('teacher:action',{code:k.code,token:k.teacherToken,action:'start',payload:{word:'새 단어',spyCount:2,spyMode:'manual',spyIds:selection}})?.ok,'v11 accepts valid manual spies');
check(k.students.filter(p=>p.s.last('student:state').you.role==='spy').every(p=>selection.includes(p.s.last('student:state').you.id)),'v11 only selected participants become spies');
check(k.students.filter(p=>p.s.last('student:state').you.role==='student').every(p=>!selection.includes(p.s.last('student:state').you.id)),'v11 unselected participants are civilians');
console.log('PASS '+total+' simulated assertions including V11 manual spy assignment and private teammate names.');
// V13: old disconnected identity is replaced by a new identity, not duplicated.
const v13=setup(5,2);
const original=v13.students[0];
const firstState=original.s.last('student:state');
const firstId=firstState.you.id;
const firstRole=firstState.you.role;
const currentClueTurn=v13.teacher.last('teacher:state').turnId;
// Simulate a genuine connection loss.
original.s.handlers.disconnect();
check(v13.teacher.last('teacher:state').players.find(p=>p.id===firstId).online===false,'v13 offline player visible until reclaimed');
const fresh=io.connect();
const reentered=fresh.send('student:join',{code:v13.code,name:original.name});
check(reentered?.ok&&reentered.rejoined,'v13 offline nickname can rejoin from a new tab / QR');
const after=v13.teacher.last('teacher:state');
check(after.players.length===5,'v13 no duplicate player on reentry');
check(!after.players.some(p=>p.id===firstId),'v13 old participant id deleted');
check(after.players.filter(p=>p.name===original.name).length===1,'v13 nickname appears exactly once');
check(fresh.last('student:state').you.role===firstRole,'v13 role maintained during active round');
check(after.turnId!==(currentClueTurn===firstId?firstId:'___'),'v13 former turn id never persists');
check(!original.s.send('student:chat',{code:v13.code,token:original.token,text:'old token attempt'})?.ok,'v13 former token invalidated');
check(fresh.send('student:chat',{code:v13.code,token:reentered.token,text:'재입장했습니다'})?.ok,'v13 new credential works');
// Teacher sees ALL submitted clues, even after new events and turns.
for(let i=0;i<3;i++){
 const st=v13.teacher.last('teacher:state');
 const current=st.players.find(p=>p.id===st.turnId);
 const source=current.name===original.name?{s:fresh,token:reentered.token}:v13.students.find(p=>p.name===current.name);
 check(source.s.send('student:clue',{code:v13.code,token:source.token,text:'기록 '+i})?.ok,'v13 accumulated clue submitted');
}
const log=v13.teacher.last('teacher:state').allClues;
check(log.length===3&&log[0].text==='기록 0'&&log[2].text==='기록 2','v13 teacher receives complete clue history');
console.log('PASS '+total+' simulated assertions including V13 reconnect replacement and persistent teacher clue log.');
// Returning in a NEW tab while the old tab is still open must require proof of ownership.
const v13b=setup(4,1);
const owner=v13b.students[0];
const savedId=owner.s.last('student:state').you.id;
const intruder=io.connect();
check(!intruder.send('student:join',{code:v13b.code,name:owner.name})?.ok,'v13 active name cannot be hijacked without token');
const duplicateTab=io.connect();
const reclaimed=duplicateTab.send('student:join',{code:v13b.code,name:owner.name,reclaimToken:owner.token});
check(reclaimed?.ok&&reclaimed.token!==owner.token,'v13 verified new tab replaces credential');
check(duplicateTab.last('student:state').you.id!==savedId,'v13 verified new tab replaces obsolete identifier');
check(v13b.teacher.last('teacher:state').players.length===4,'v13 verified new tab causes no duplicates');
console.log('PASS '+total+' simulated assertions including V13 new tab authenticated reclaim.');
