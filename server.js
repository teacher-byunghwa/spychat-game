'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { randomBytes, randomInt, timingSafeEqual } = require('crypto');
const app = express();
app.disable('x-powered-by');
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000 });
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const MAX_PLAYERS = 60;
const uid = () => randomBytes(18).toString('hex');
const trim = (v, max) => String(v ?? '').trim().slice(0, max);
const now = () => Date.now();
function roomCode() { let k; do { k = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(k)); return k; }
function equal(a,b) { if(typeof a !== 'string' || typeof b !== 'string') return false; const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }
function shuffle(items) { for(let i=items.length-1;i>0;i--){ const j=randomInt(i+1); [items[i],items[j]]=[items[j],items[i]]; } return items; }
function active(p) { return !p.out && !p.kicked; }
function list(room) { return [...room.players.values()].filter(p=>!p.kicked).map(p=>({id:p.id,name:p.name,online:!!p.socketId,out:p.out,revealed:p.revealed,score:p.score})); }
function turnPlayer(room) { return room.turnOrder[room.turnIndex] || null; }
function publicState(room) { return { code:room.code,phase:room.phase,round:room.round,gameVersion:room.gameVersion,paused:room.paused,players:list(room),spyCount:room.spyCount,turnId:turnPlayer(room),clues:room.clues.slice(-80),chat:room.chat.slice(-60),highlight:room.highlight,history:room.history.slice(-20),result:room.result,submitted:room.submitted,completedDescriptions:room.completedDescriptions?.size||0,finalGuessDeadline:room.finalGuessDeadline||null,finalGuessRemaining:room.finalGuessRemaining||null,serverTime:now(),connectedCount:list(room).filter(p=>p.online).length,activeCount:list(room).filter(p=>!p.out).length }; }
function teacherState(room) {return {...publicState(room),word:room.word,teacherOnline:!!room.teacherSocketId,spyIds:[...room.players.values()].filter(p=>p.role==='spy').map(p=>p.id)}; }
function personalState(room,p){return {...publicState(room),you:{id:p.id,name:p.name,role:p.role,word:p.role==='student'&&room.phase!=='lobby' ? room.word : null,score:p.score,out:p.out,spyGuessAttempts:p.role==='spy'?(p.spyGuessAttempts||0):null,spyTeammates:p.role==='spy'&&room.phase!=='lobby' ? [...room.players.values()].filter(q=>q.role==='spy'&&!q.kicked&&q.id!==p.id).map(q=>({id:q.id,name:q.name,out:q.out})) : []}};}
function emitRoom(room){ if(room.teacherSocketId) io.to(room.teacherSocketId).emit('teacher:state',teacherState(room)); for(const p of room.players.values()) if(p.socketId) io.to(p.socketId).emit('student:state',personalState(room,p)); }
function audit(room,msg,forStudents=true){room.history.push({id:uid(),message:msg,time:now()}); room.history=room.history.slice(-80); if(!forStudents && room.history.length) room.history.pop();}
function notify(socket,event,message){socket.emit(event,{message});}
function fail(socket,message){notify(socket,'error:message',message);}
function current(room,p) {return (room.phase==='playing'||(room.phase==='final_guess'&&p.role==='spy'&&room.finalGuessDeadline>now())) && !room.paused && active(p);}
function clearFinalTimer(room){if(room.finalGuessTimer)clearTimeout(room.finalGuessTimer);room.finalGuessTimer=null;room.finalGuessDeadline=null;room.finalGuessRemaining=null;}
function civilianTimeVictory(room){if(room.phase!=='final_guess'||room.paused)return;endRound(room,'최종 추리 시간 60초 종료! 스파이가 제시어를 맞히지 못해 일반학생팀 승리 · 일반학생 전원 +1점','student');emitRoom(room);}
function scheduleFinalTimer(room,remaining=60000){room.finalGuessRemaining=remaining;room.finalGuessDeadline=now()+remaining;room.finalGuessTimer=setTimeout(()=>civilianTimeVictory(room),remaining);}
function beginFinalGuess(room){if(room.phase!=='playing')return false;room.phase='final_guess';room.highlight=null;room.submitted=false;audit(room,'모든 설명 완료! 생존 스파이에게 최종 제시어 추리 시간 60초가 주어집니다.');scheduleFinalTimer(room);return true;}
function updateTurn(room){const pids=room.turnOrder; if(!pids.length){room.turnIndex=0;return;}let idx=room.turnIndex%pids.length;for(let n=0;n<pids.length;n++){const p=room.players.get(pids[idx]);if(p&&active(p)){room.turnIndex=idx;room.submitted=false;return;}idx=(idx+1)%pids.length;}room.turnIndex=0;room.submitted=false;}
function advanceTurn(room){if(!room.turnOrder.length)return; room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;updateTurn(room);}
function endRound(room,message,winner=null){
 if(room.phase==='finished')return;
 clearFinalTimer(room);
 // Award team victory exactly once, for both timeout and elimination of all spies.
 const teamBonus=new Map();
 if(winner==='student'){for(const p of room.players.values()){if(p.role==='student'&&!p.kicked){p.score+=1;teamBonus.set(p.id,1);}}}
 // Delay civilian challenge rewards until the round ends to protect the challenger's anonymity.
 for(const p of room.players.values()){p.score+=(p.pendingScore||0);p.pendingScore=0;}
 room.phase='finished';room.paused=false;
 const ranking=[...room.players.values()].filter(p=>!p.kicked).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ko'));
 let prev=null,rank=0;
 const leaderboard=ranking.map((p,i)=>{if(prev!==p.score)rank=i+1;prev=p.score;return {id:p.id,name:p.name,score:p.score,rank,teamBonus:teamBonus.get(p.id)||0};});
 room.result={id:uid(),message,winner,word:room.word,spies:[...room.players.values()].filter(p=>p.role==='spy'&&!p.kicked).map(p=>({id:p.id,name:p.name})),leaderboard};
 room.highlight=null;audit(room,message);
}
function maybeEndOnDescriptionsComplete(room){
 if(room.phase!=='playing')return false;
 const eligible=[...room.players.values()].filter(p=>active(p));
 if(!eligible.length||!eligible.every(p=>room.completedDescriptions.has(p.id)))return false;
 // Give surviving spies one final 60-second guessing window.
 return beginFinalGuess(room);
}
function maybeEndOnSpiesCaught(room){if([...room.players.values()].filter(p=>p.role==='spy').every(p=>p.out)){endRound(room,'모든 스파이를 찾아냈습니다! 일반학생팀 승리 · 일반학생 전원 +1점','student');return true;}return false;}
function guarded(socket,ack,fn){try{fn()}catch(e){console.error(e);fail(socket,'처리 중 오류가 발생했습니다.');} }
function getTeacher(socket,code,token){const room=rooms.get(trim(code,6).toUpperCase());if(!room||!equal(room.teacherToken,token)){fail(socket,'교사 인증에 실패했습니다.');return null;}return room;}
function getStudent(socket,code,token){const room=rooms.get(trim(code,6).toUpperCase());if(!room){fail(socket,'게임방이 없습니다.');return null;}const p=[...room.players.values()].find(p=>equal(p.token,token)&&!p.kicked);if(!p){fail(socket,'학생 인증에 실패했습니다.');return null;}if(socket.id!==p.socketId){fail(socket,'현재 연결된 계정으로만 사용할 수 있습니다.');return null;}return {room,p};}
function bindTeacher(socket,room){if(room.teacherSocketId && room.teacherSocketId!==socket.id) io.to(room.teacherSocketId).emit('session:replaced');room.teacherSocketId=socket.id;socket.data.teacher=room.code;socket.join('room:'+room.code);emitRoom(room);}
function bindStudent(socket,room,p){if(p.socketId && p.socketId!==socket.id)io.to(p.socketId).emit('session:replaced');p.socketId=socket.id;socket.data.student={code:room.code,id:p.id};socket.join('room:'+room.code);emitRoom(room);}
io.on('connection',socket=>{
 socket.on('room:create',(_,ack)=>guarded(socket,ack,()=>{const code=roomCode();const room={code,teacherToken:uid(),teacherSocketId:null,players:new Map(),phase:'lobby',round:0,gameVersion:1,paused:false,finalGuessDeadline:null,finalGuessRemaining:null,finalGuessTimer:null,word:'',spyCount:1,turnOrder:[],turnIndex:0,submitted:false,clues:[],chat:[],highlight:null,history:[],result:null,completedDescriptions:new Set()};rooms.set(code,room);bindTeacher(socket,room);ack?.({ok:true,code,token:room.teacherToken});}));
 socket.on('teacher:rejoin',({code,token}={},ack)=>guarded(socket,ack,()=>{const room=getTeacher(socket,code,token);if(!room)return;bindTeacher(socket,room);ack?.({ok:true});}));
 socket.on('student:join',({code,name,token}={},ack)=>guarded(socket,ack,()=>{const room=rooms.get(trim(code,6).toUpperCase());if(!room){fail(socket,'입장 코드가 올바르지 않습니다.');return;} if(token){const p=[...room.players.values()].find(p=>equal(p.token,token)&&!p.kicked);if(p){bindStudent(socket,room,p);ack?.({ok:true,code:room.code,token:p.token,name:p.name});return;}}
 if(room.phase!=='lobby'){fail(socket,'게임 진행 중에는 신규 입장할 수 없습니다. 다음 라운드를 기다려 주세요.');return;}
 const n=trim(name,14);if(n.length<1){fail(socket,'이름을 입력해 주세요.');return;}if([...room.players.values()].some(p=>p.name===n&&!p.kicked)){fail(socket,'이미 사용 중인 이름입니다.');return;}if([...room.players.values()].filter(p=>!p.kicked).length>=MAX_PLAYERS){fail(socket,'입장 인원이 가득 찼습니다.');return;}
 const p={id:uid(),token:uid(),name:n,socketId:null,role:null,score:0,pendingScore:0,spyGuessAttempts:0,out:false,kicked:false,revealed:false};room.players.set(p.id,p);bindStudent(socket,room,p);audit(room,`${n} 입장`);emitRoom(room);ack?.({ok:true,code:room.code,token:p.token,name:p.name});}));
 socket.on('teacher:action',({code,token,action,payload={}}={},ack)=>guarded(socket,ack,()=>{const r=getTeacher(socket,code,token);if(!r)return;const all=[...r.players.values()].filter(p=>!p.kicked);const n=Number(payload.spyCount);
 switch(action){
 case 'start': {if(r.phase!=='lobby'&&r.phase!=='finished'){fail(socket,'현재 라운드를 종료한 뒤 시작해 주세요.');return;}if(all.length<3){fail(socket,'최소 3명이 필요합니다.');return;}const word=trim(payload.word,40);if(!word){fail(socket,'제시어를 입력해 주세요.');return;}if(!Number.isInteger(n)||n<1||n>=all.length){fail(socket,'스파이는 1명 이상, 참여자 수보다 적어야 합니다.');return;}const mode=payload.spyMode==='manual'?'manual':'random';
 let spies;
 if(mode==='manual'){
  if(!Array.isArray(payload.spyIds)||payload.spyIds.length!==n||new Set(payload.spyIds).size!==n||payload.spyIds.some(id=>typeof id!=='string'||!all.some(p=>p.id===id))){fail(socket,'직접 선택한 스파이 인원이 설정한 숫자와 같아야 합니다.');return;}
  spies=new Set(payload.spyIds);
 }else{const ids=shuffle(all.map(p=>p.id));spies=new Set(ids.slice(0,n));}r.word=word;r.spyCount=n;r.round++;clearFinalTimer(r);r.phase='playing';r.paused=false;r.result=null;r.clues=[];r.chat=[];r.history=[];r.highlight=null;r.submitted=false;r.completedDescriptions=new Set();for(const p of all){p.role=spies.has(p.id)?'spy':'student';p.out=false;p.revealed=false;p.pendingScore=0;p.spyGuessAttempts=0;}r.turnOrder=shuffle(all.map(p=>p.id));r.turnIndex=0;updateTurn(r);audit(r,`라운드 ${r.round} 시작`);break;}
 case 'pause': if(r.phase!=='playing'&&r.phase!=='final_guess')return;r.paused=!r.paused;if(r.phase==='final_guess'){if(r.paused){r.finalGuessRemaining=Math.max(0,r.finalGuessDeadline-now());clearTimeout(r.finalGuessTimer);r.finalGuessTimer=null;r.finalGuessDeadline=null;}else{scheduleFinalTimer(r,r.finalGuessRemaining||1);}}audit(r,r.paused?'교사가 게임을 일시정지했습니다.':'게임이 재개되었습니다.');break;
 case 'stop': if(r.phase!=='playing'&&r.phase!=='final_guess')return;endRound(r,'교사가 라운드를 종료했습니다.');break;
 case 'skip': if(r.phase!=='playing'||r.paused)return;{const skipped=turnPlayer(r);if(skipped)r.completedDescriptions.add(skipped);r.highlight=null;if(!maybeEndOnDescriptionsComplete(r))advanceTurn(r);}break;
 case 'new_game': {
  if(r.phase!=='finished'){fail(socket,'라운드가 끝난 다음 새 게임을 시작할 수 있습니다.');return;}
  clearFinalTimer(r);r.phase='lobby';r.round=0;r.gameVersion++;r.word='';r.paused=false;r.highlight=null;r.clues=[];r.chat=[];r.history=[];r.result=null;r.turnOrder=[];r.turnIndex=0;r.submitted=false;r.completedDescriptions=new Set();
  for(const p of all){p.role=null;p.out=false;p.revealed=false;p.score=0;p.pendingScore=0;p.spyGuessAttempts=0;}
  audit(r,'새 게임 준비 완료 · 기존 참가자는 유지하고 모든 점수를 0점으로 초기화했습니다.');break;
 }
 case 'lobby': if(r.phase==='playing'||r.phase==='final_guess'){fail(socket,'먼저 라운드를 종료해 주세요.');return;}clearFinalTimer(r);r.phase='lobby';r.paused=false;r.highlight=null;r.clues=[];r.chat=[];r.history=[];r.result=null;r.turnOrder=[];r.turnIndex=0;r.submitted=false;r.completedDescriptions=new Set();for(const p of all){p.role=null;p.out=false;p.revealed=false;}break;
 case 'kick': {const p=r.players.get(trim(payload.playerId,64));if(!p||p.kicked)return;p.kicked=true;p.out=true; if(p.socketId){io.to(p.socketId).emit('student:kicked');const s=io.sockets.sockets.get(p.socketId);if(s)s.disconnect(true);}p.socketId=null;audit(r,`${p.name} 강퇴됨`);if(r.phase==='playing'||r.phase==='final_guess'){if(p.role==='spy')maybeEndOnSpiesCaught(r);if(r.phase==='playing'&&!maybeEndOnDescriptionsComplete(r))updateTurn(r);}break;}
 default:fail(socket,'알 수 없는 교사 명령입니다.');return;
 }emitRoom(r);ack?.({ok:true});}));
 // Casual classroom chat: no roles or secrets are included in public messages.
 socket.on('student:chat',({code,token,text}={},ack)=>guarded(socket,ack,()=>{
  const x=getStudent(socket,code,token);if(!x)return;
  const {room:r,p}=x;
  if(r.phase==='finished'||r.paused||p.out){fail(socket,'지금은 자유 채팅을 보낼 수 없습니다.');return;}
  const message=trim(text,160);
  if(!message){fail(socket,'메시지를 입력해 주세요.');return;}
  if(now()-(p.lastChatAt||0)<1200){fail(socket,'조금 뒤에 다시 보내 주세요.');return;}
  p.lastChatAt=now();
  r.chat.push({id:uid(),playerId:p.id,name:p.name,text:message,time:now()});
  r.chat=r.chat.slice(-60);
  emitRoom(r);ack?.({ok:true});
 }));
 socket.on('student:clue',({code,token,text}={},ack)=>guarded(socket,ack,()=>{const x=getStudent(socket,code,token);if(!x)return;const {room:r,p}=x;if(r.phase!=='playing'||!current(r,p)){fail(socket,'현재 설명을 제출할 수 없습니다.');return;}if(turnPlayer(r)!==p.id||r.submitted){fail(socket,'아직 본인 차례가 아닙니다.');return;}const clue=trim(text,120);if(clue.length<2){fail(socket,'설명은 두 글자 이상 입력해 주세요.');return;}r.submitted=true;r.clues.push({id:uid(),playerId:p.id,name:p.name,text:clue,time:now()});r.highlight={playerId:p.id,name:p.name,text:clue};r.completedDescriptions.add(p.id);audit(r,`${p.name} 설명 등록`);if(!maybeEndOnDescriptionsComplete(r))advanceTurn(r);emitRoom(r);ack?.({ok:true});}));
 socket.on('student:challenge',({code,token,targetId,word}={},ack)=>guarded(socket,ack,()=>{const x=getStudent(socket,code,token);if(!x)return;const {room:r,p}=x;if(!current(r,p)){fail(socket,'현재 챌린지를 신청할 수 없습니다.');return;}if(r.phase==='final_guess'&&p.role!=='spy'){fail(socket,'최종 추리 시간에는 생존 스파이만 제시어를 맞힐 수 있습니다.');return;}let announcement=null;if(p.role==='spy'){
 const guess=trim(word,40);if(!guess){fail(socket,'정답으로 생각하는 제시어를 입력해 주세요.');return;}const normalize=s=>s.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase('ko-KR');if(normalize(guess)===normalize(r.word)){
  // Guesser gets 2 total. Every other spy gets 1, including previously out spies.
  for(const other of r.players.values()){if(other.role==='spy'){other.score+=other.id===p.id?2:1;}}
  endRound(r,'스파이가 제시어를 맞혔습니다! 스파이팀 승리');
  announcement={id:uid(),type:'spy-win',title:'🕵️ 스파이팀 승리!',message:'스파이가 제시어를 맞혔습니다! 라운드가 종료되었습니다.'};
  socket.emit('challenge:feedback',{success:true,message:'정답입니다! 본인 +2점, 다른 스파이 각각 +1점 (아웃된 스파이 포함)'});
 } else {p.spyGuessAttempts=(p.spyGuessAttempts||0)+1; if(p.spyGuessAttempts===1){socket.emit('challenge:feedback',{success:false,message:'첫 번째 오답입니다. 한 번 더 도전할 수 있습니다. (남은 기회 1회)'});emitRoom(r);ack?.({ok:true});return;} p.out=true;p.revealed=true;audit(r,`스파이 ${p.name}의 두 번째 추측 실패 — 정체 공개`);announcement={id:uid(),type:'spy-out',eliminatedId:p.id,eliminatedName:p.name,title:'🚨 스파이 아웃!',message:`${p.name} 학생은 스파이였습니다! 두 번의 제시어 추측에 실패하여 아웃되었습니다.`};socket.emit('challenge:feedback',{success:false,message:'두 번째 오답입니다. 스파이 정체가 공개되고 아웃되었습니다.'});if(!maybeEndOnSpiesCaught(r)&&r.phase==='playing'&&!maybeEndOnDescriptionsComplete(r))updateTurn(r);}
 } else {
  const target=r.players.get(trim(targetId,64));if(!target||target.kicked||target.out||target.id===p.id){fail(socket,'챌린지할 수 없는 대상입니다.');return;}
  if(target.role==='spy'){p.pendingScore=(p.pendingScore||0)+1;target.out=true;target.revealed=true;audit(r,`${target.name}은(는) 스파이였습니다! (정체 공개)`);announcement={id:uid(),type:'spy-out',eliminatedId:target.id,eliminatedName:target.name,title:'🎯 스파이 발견!',message:`${target.name} 학생은 스파이였습니다! 정체가 공개되고 아웃되었습니다.`};socket.emit('challenge:feedback',{success:true,message:`정답! ${target.name}은(는) 스파이입니다. 라운드 종료 시 +1점이 반영됩니다.`});if(!maybeEndOnSpiesCaught(r)&&r.phase==='playing'&&!maybeEndOnDescriptionsComplete(r))updateTurn(r);
  }else{p.out=true;audit(r,`일반학생 ${p.name}이(가) 잘못 지목하여 아웃되었습니다.`);announcement={id:uid(),type:'student-out',eliminatedId:p.id,eliminatedName:p.name,title:'❌ 일반학생 아웃!',message:`${p.name} 학생이 스파이 지목에 실패하여 아웃되었습니다.`};socket.emit('challenge:feedback',{success:false,message:`오답! ${target.name}은(는) 일반학생입니다. 본인이 아웃되었습니다.`});if(!maybeEndOnDescriptionsComplete(r))updateTurn(r);}
 }
 // The challenge applicant is never named for a successful civilian challenge.
 // Only the eliminated player's identity is announced to everyone.
 // Broadcast the challenge reveal first; clients queue the round-end leaderboard behind it.
 if(announcement)io.to('room:'+r.code).emit('challenge:announcement',announcement);emitRoom(r);ack?.({ok:true});}));
 socket.on('disconnect',()=>{const t=socket.data.teacher;if(t){const r=rooms.get(t);if(r?.teacherSocketId===socket.id){r.teacherSocketId=null;emitRoom(r);}}const st=socket.data.student;if(st){const r=rooms.get(st.code);const p=r?.players.get(st.id);if(p?.socketId===socket.id){p.socketId=null;emitRoom(r);}}});
});
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
app.get('/qr/:code',async(req,res)=>{const code=trim(req.params.code,6).toUpperCase();if(!rooms.has(code))return res.status(404).send('Not found');const configured=trim(process.env.PUBLIC_URL,200).replace(/\/$/,'');const url=(configured||`${req.protocol}://${req.get('host')}`)+`/?room=${encodeURIComponent(code)}`;try{const png=await QRCode.toBuffer(url,{width:450,margin:1,errorCorrectionLevel:'M'});res.type('png').send(png);}catch(e){res.status(500).send('QR generation error');}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Spy chat game running on :${PORT}`));
