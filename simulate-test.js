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
