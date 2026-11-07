'use strict';
const socket=io({reconnection:true});
const $=id=>document.getElementById(id);
const session={mode:null,code:null,token:null,state:null};
let timer=null;
let audioContext=null;
let soundEnabled=false;
let lastRoundShown=null;
let pendingRound=null;
let clockOffset=0;
function updateFinalClock(){const s=session.state;if(!s)return;const final=s.phase==='final_guess';const remaining=s.paused?(s.finalGuessRemaining||0):Math.max(0,(s.finalGuessDeadline||0)-(Date.now()+clockOffset));const str='00:'+String(Math.ceil(remaining/1000)).padStart(2,'0');for(const [bar,counter] of [['finalGuessBar','finalGuessCountdown'],['teacherFinalGuessBar','teacherFinalGuessCountdown']]){const b=$(bar);if(!b)continue;b.hidden=!final;if(final)$(counter).textContent=str;}if(final&&remaining<=0&&session.mode==='student'){$('challengeBtn').disabled=true;}}
setInterval(updateFinalClock,250);
const seenAnnouncements=new Set();
function beep(freq,duration,delay=0,volume=.12,type='sine'){
 if(!soundEnabled)return;
 try{audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();
 if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
 const t=audioContext.currentTime+delay,osc=audioContext.createOscillator(),gain=audioContext.createGain();
 osc.type=type;osc.frequency.setValueAtTime(freq,t);gain.gain.setValueAtTime(0,t);
 gain.gain.linearRampToValueAtTime(volume,t+.012);
 gain.gain.exponentialRampToValueAtTime(.001,t+duration);
 osc.connect(gain);gain.connect(audioContext.destination);osc.start(t);osc.stop(t+duration+.02);
 }catch(e){console.warn('효과음 재생 불가',e);}
}
function playSound(type){
 if(type==='success'||type==='round'){beep(523,.16);beep(659,.17,.16);beep(784,.24,.34);if(type==='round')beep(1047,.4,.59);}
 else if(type==='failure'){beep(392,.19,0,.1,'triangle');beep(294,.22,.19,.1,'triangle');beep(196,.34,.4,.1,'triangle');}
 else if(type==='clue'){beep(670,.09,0,.06);beep(880,.10,.1,.06);}
}
$('soundBtn').onclick=()=>{soundEnabled=!soundEnabled;$('soundBtn').textContent=soundEnabled?'🔊 소리 끄기':'🔇 소리 켜기';$('soundBtn').setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)playSound('clue');};
function addRanks(target,ranking){
 const root=$(target);root.replaceChildren();const heading=elem('h2',null,'🏅 누적 순위표');root.append(heading);
 if(!ranking?.length){root.append(elem('p','muted','표시할 참가자가 없습니다.'));return;}
 ranking.forEach(p=>{const line=elem('div','rankLine'+(p.rank<=3?' topRank':''));const medal=p.rank===1?'🥇':p.rank===2?'🥈':p.rank===3?'🥉':`${p.rank}위`;line.append(elem('span','rankPlace',medal),elem('b','rankName',p.name),elem('strong','rankScore',`${p.score}점${p.teamBonus ? ' (팀 승리 +1)' : ''}`));root.append(line);});
}
function showRoundResult(result){if(!result||lastRoundShown===result.id)return;lastRoundShown=result.id;
 $('roundPopupMessage').textContent=result.message+` · 제시어: ${result.word} · 스파이: ${result.spies.map(p=>p.name).join(', ')}`;
 $('roundArt').src='/assets/celebration.svg';
 addRanks('roundPopupRanks',result.leaderboard);$('roundPopup').hidden=false;playSound('round');
}
function stageRoundResult(result){if(!result||lastRoundShown===result.id)return;
 pendingRound=result;if($('resultPopup').hidden)flushRound();}
function flushRound(){if(pendingRound&&$('resultPopup').hidden){const result=pendingRound;pendingRound=null;showRoundResult(result);}}
$('dismissRound').onclick=()=>{$('roundPopup').hidden=true;};

const elem=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
function toast(message){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(timer);timer=setTimeout(()=>t.hidden=true,4000);}
function show(mode){session.mode=mode;['home','teacher','student'].forEach(id=>$(id).hidden=id!==mode);}
function save(){localStorage.setItem('spy-game-session',JSON.stringify({mode:session.mode,code:session.code,token:session.token}));}
function request(event,data,cb){if(!socket.connected){toast('서버 연결을 확인해 주세요.');return;}socket.emit(event,data,(reply)=>{if(reply?.ok)cb?.(reply);});}
function inviteUrl(){return `${location.origin}/?room=${encodeURIComponent(session.code)}`;}
function teacherAction(action,payload={}){request('teacher:action',{code:session.code,token:session.token,action,payload},()=>{if(action==='start')toast('라운드를 시작했습니다.');});}
function attach(){const saved=JSON.parse(localStorage.getItem('spy-game-session')||'null');const room=new URLSearchParams(location.search).get('room');if(room)$('roomCode').value=room.toUpperCase();if(!saved?.code||!saved?.token)return;if(room&&room.toUpperCase()!==saved.code)return;session.mode=saved.mode;session.code=saved.code;session.token=saved.token;if(saved.mode==='teacher')request('teacher:rejoin',{code:saved.code,token:saved.token},()=>{show('teacher');renderTeacher();});else if(saved.mode==='student')request('student:join',{code:saved.code,token:saved.token},()=>show('student'));}
socket.on('connect',()=>{$('connection').textContent='● 서버 연결됨';attach();});socket.on('disconnect',()=>{$('connection').textContent='○ 연결 끊김';});socket.on('error:message',e=>toast(e.message));socket.on('session:replaced',()=>{toast('다른 기기에서 접속하여 연결이 바뀌었습니다.');localStorage.removeItem('spy-game-session');show('home');});socket.on('student:kicked',()=>{localStorage.removeItem('spy-game-session');session.state=null;show('home');toast('교사가 게임방에서 퇴장시켰습니다.');});
socket.on('teacher:state',state=>{if(session.mode==='teacher'||session.mode===null){
 const previous=session.state;session.state=state;clockOffset=state.serverTime-Date.now();session.code=state.code;if(state.phase==='lobby'&&previous?.phase==='finished'){pendingRound=null;resultQueue.length=0;$('resultPopup').hidden=true;$('roundPopup').hidden=true;}show('teacher');renderTeacher();updateFinalClock();
 if(previous?.round===state.round&&previous.clues?.length<state.clues.length)playSound('clue');
 if(state.phase==='finished')stageRoundResult(state.result);
 }});
socket.on('student:state',state=>{if(session.mode==='student'){
 const previous=session.state;session.state=state;clockOffset=state.serverTime-Date.now();if(state.phase==='lobby'&&previous?.phase==='finished'){pendingRound=null;resultQueue.length=0;$('resultPopup').hidden=true;$('roundPopup').hidden=true;}renderStudent();updateFinalClock();
 if(previous?.round===state.round&&previous.clues?.length<state.clues.length)playSound('clue');
 if(state.phase==='finished')stageRoundResult(state.result);
 }});
socket.on('challenge:feedback',e=>toast(e.message));
// Results are broadcast by the server to every participant, including the teacher.
// Do not display the challenger name unless that player was eliminated.
const resultQueue=[];
function showNextResult(){if(!$('resultPopup').hidden){return;}if(!resultQueue.length){flushRound();return;}
 const item=resultQueue.shift();$('resultPopup').classList.remove('successEffect','failureEffect');
 const success=item.type==='spy-win'||(item.title||'').includes('발견');
 $('resultPopup').classList.add(success?'successEffect':'failureEffect');
 $('resultPopupIcon').textContent=item.type==='student-out'?'❌':item.type==='spy-win'?'🏆':'🚨';
 $('resultPopupTitle').textContent=item.title;
 // Names are supplied by the server from the actual eliminated participant record.
 // A missing or invalid name must NEVER be replaced with an example student's name.
 if(item.type==='student-out'||item.type==='spy-out'){
  const actual=session.state?.players?.find(p=>p.id===item.eliminatedId);
  const name=actual?.name||item.eliminatedName;
  $('resultPopupMessage').textContent=name ? (item.type==='student-out' ? `${name} 학생이 스파이 지목에 실패하여 탈락했습니다.` : `${name} 학생은 스파이였습니다! 정체가 공개되고 탈락했습니다.`) : '참가자 한 명이 탈락했습니다.';
 } else $('resultPopupMessage').textContent=item.message;
 const art=$('resultArt');art.src=item.type==='student-out'?'/assets/student-character.png':'/assets/spy-character.png';art.alt=item.type==='student-out'?'일반학생 캐릭터':'스파이 캐릭터';
 const confetti=$('confetti');confetti.replaceChildren();
 if(success){for(let i=0;i<24;i++){const dot=elem('i','confettiPiece');dot.style.setProperty('--x',`${(i*37)%100}%`);dot.style.setProperty('--delay',`${(i%6)*.09}s`);dot.style.setProperty('--hue',String((i*47)%360));confetti.append(dot);}}
 $('resultPopup').hidden=false;playSound(success?'success':'failure');
}
socket.on('challenge:announcement',item=>{
 if(item.id&&seenAnnouncements.has(item.id))return;
 if(item.id)seenAnnouncements.add(item.id);
 resultQueue.push(item);showNextResult();
});
$('dismissResult').onclick=()=>{$('resultPopup').hidden=true;showNextResult();maybeShowTurnReminder();};

$('createBtn').onclick=()=>request('room:create',{},r=>{session.mode='teacher';session.code=r.code;session.token=r.token;save();show('teacher');renderTeacher();});
$('joinBtn').onclick=()=>{const code=$('roomCode').value.trim().toUpperCase();const name=$('studentName').value.trim();if(code.length!==6||!name)return toast('6자리 방 코드와 별명을 입력해 주세요.');request('student:join',{code,name},r=>{session.mode='student';session.code=r.code;session.token=r.token;save();show('student');});};
$('studentName').addEventListener('keydown',e=>{if(e.key==='Enter')$('joinBtn').click();});
$('copyLink').onclick=()=>navigator.clipboard.writeText(inviteUrl()).then(()=>toast('입장 링크를 복사했습니다.')).catch(()=>toast('브라우저에서 복사가 제한되어 있습니다.'));
// The teacher explicitly chooses automatic or manual spy assignment on every start.
function updateManualSpySection(){const manual=document.querySelector('input[name="spyMode"]:checked')?.value==='manual';$('manualSpySection').hidden=!manual;updateManualSpyCount();}
function updateManualSpyCount(){const chosen=document.querySelectorAll('#manualSpyPlayers input:checked').length;const wanted=Number($('spyInput').value);$('manualSpyCount').textContent=`선택 ${chosen}명 / 설정 ${wanted}명`;}
$('startBtn').onclick=()=>{const s=session.state;if(!s)return;const word=$('wordInput').value.trim();const count=Number($('spyInput').value);if(!word)return toast('제시어를 먼저 입력하세요.');if(!Number.isInteger(count)||count<1||count>=s.players.length)return toast('스파이 인원과 참가자 수를 확인하세요.');const holder=$('manualSpyPlayers');holder.replaceChildren();s.players.forEach(p=>{const label=elem('label','option');const cb=elem('input');cb.type='checkbox';cb.value=p.id;cb.addEventListener('change',updateManualSpyCount);label.append(cb,elem('span',null,p.name));holder.append(label);});document.querySelector('input[name="spyMode"][value="random"]').checked=true;updateManualSpySection();$('spySelectModal').hidden=false;};
document.querySelectorAll('input[name="spyMode"]').forEach(r=>r.onchange=updateManualSpySection);
$('cancelSpySelection').onclick=()=>{$('spySelectModal').hidden=true;};
$('confirmSpySelection').onclick=()=>{const count=Number($('spyInput').value),mode=document.querySelector('input[name="spyMode"]:checked')?.value||'random';const ids=[...document.querySelectorAll('#manualSpyPlayers input:checked')].map(input=>input.value);if(mode==='manual'&&ids.length!==count)return toast(`스파이를 정확히 ${count}명 선택하세요.`);if(mode==='manual'&&!confirm('선택한 학생들을 스파이로 지정할까요?'))return;request('teacher:action',{code:session.code,token:session.token,action:'start',payload:{word:$('wordInput').value,spyCount:count,spyMode:mode,spyIds:mode==='manual'?ids:[]}},()=>{$('spySelectModal').hidden=true;toast('라운드를 시작했습니다.');});};
$('pauseBtn').onclick=()=>teacherAction('pause');$('skipBtn').onclick=()=>teacherAction('skip');$('stopBtn').onclick=()=>{if(confirm('이번 라운드를 즉시 종료할까요?'))teacherAction('stop');};$('lobbyBtn').onclick=()=>{if(confirm('대기실로 돌아갈까요? 점수는 유지됩니다.'))teacherAction('lobby');};
$('newGameBtn').onclick=()=>{if(confirm('새 게임을 시작할까요? 참가자와 방 코드는 유지하지만 모든 학생 점수는 0점으로 초기화됩니다.'))teacherAction('new_game');};
function makePlayer(p,teacher=false,role=null){const root=elem('div','player'+(p.out?' out':''));root.append(elem('div','avatar',p.out?'✕':'🙂'));const meta=elem('div','playerMeta');meta.append(elem('b',null,p.name));const labels=[p.out?'아웃':p.online?'접속 중':'오프라인'];if(p.revealed)labels.push('스파이 공개');if(teacher&&role==='spy')labels.push('🕵️ 스파이');meta.append(elem('small',null,labels.join(' · ')));root.append(meta,elem('div','playerScore',p.score+'점'));if(teacher){const kick=elem('button','kick','강퇴');kick.disabled=p.out&&p.revealed;kick.onclick=()=>{if(confirm(`${p.name} 학생을 강퇴할까요?`))teacherAction('kick',{playerId:p.id});};root.append(kick);}return root;}
function renderChat(id,messages){
 const el=$(id);if(!el)return;
 const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<55;
 const existing=el.dataset.lastId||'';
 const incoming=messages?.at(-1)?.id||'';
 if(existing===incoming)return;
 el.dataset.lastId=incoming;
 el.replaceChildren();
 if(!messages?.length){el.append(elem('p','muted small','아직 자유 채팅이 없습니다.'));return;}
 for(const m of messages){const line=elem('div','casualMessage');line.append(elem('b',null,m.name));line.append(elem('span',null,m.text));el.append(line);}
 if(nearBottom||!existing)el.scrollTop=el.scrollHeight;
}
$('chatForm').onsubmit=e=>{
 e.preventDefault();const field=$('chatInput');const value=field.value.trim();
 if(!value)return;
 request('student:chat',{code:session.code,token:session.token,text:value},()=>{field.value='';});
};
function renderHighlight(where,item,empty){const target=$(where);target.replaceChildren();target.classList.toggle('empty',!item);if(item){target.append(elem('div','who',item.name+'의 설명'),elem('div',null,item.text));}else target.textContent=empty;}
function renderTeacher(){const s=session.state;if(!s)return;$('teacherCode').textContent=s.code;$('qr').src='/qr/'+s.code;$('entryUrl').textContent=inviteUrl();$('playerCount').textContent=s.players.length;$('onlineCount').textContent=s.players.filter(p=>p.online).length;$('roundNum').textContent=s.round;
 const playing=s.phase==='playing'||s.phase==='final_guess';$('startBtn').disabled=playing;$('pauseBtn').disabled=!playing;$('stopBtn').disabled=!playing;$('skipBtn').disabled=s.phase!=='playing'||s.paused;$('lobbyBtn').disabled=playing;$('newGameBtn').hidden=s.phase!=='finished';$('newGameBtn').disabled=s.phase!=='finished';$('wordInput').disabled=playing;$('spyInput').disabled=playing;$('pauseBtn').textContent=s.paused?'▶ 게임 재개':'⏸ 일시정지';$('spyInput').max=Math.max(1,s.players.length-1);
 const alive=s.players.filter(p=>!p.out);const spies=s.spyIds.filter(id=>alive.some(p=>p.id===id));
 $('liveConnected').textContent=`${s.connectedCount} / ${s.players.length}`;
 $('liveAlive').textContent=`${alive.length}명`;
 $('liveSpies').textContent=`${playing?spies.length:0}명`;
 $('liveClues').textContent=`${s.clues.length}개`;
 $('livePhase').textContent=s.phase==='lobby'?'입장 대기':s.phase==='finished'?'라운드 종료':s.paused?'일시정지':s.phase==='final_guess'?'최종 추리 60초':'진행 중';
 const livePlayer=s.players.find(p=>p.id===s.turnId);
 $('liveTurnName').textContent=s.phase==='playing'?(livePlayer?.name||'대기 중'):'현재 차례 없음';
 $('liveTurnInfo').textContent=s.phase==='playing'?(s.paused?'교사가 일시정지한 상태입니다.': '설명을 입력하면 다음 학생으로 자동 이동합니다.'):'게임 시작 시 차례가 표시됩니다.';
 $('lastActivity').textContent=s.history.length?new Date(s.history[s.history.length-1].time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
 $('teacherLiveEvents').replaceChildren(...[...s.history].slice(-5).reverse().map(h=>elem('div','eventLine',h.message)));
 if(s.phase==='lobby'&&s.round===0)$('wordInput').value='';$('teacherRanking').hidden=s.phase!=='finished';if(s.phase==='finished')addRanks('teacherRanking',s.result?.leaderboard);
 if(playing&&!$('wordInput').value)$('wordInput').value=s.word;const turn=s.players.find(p=>p.id===s.turnId);$('teacherStatus').textContent=s.phase==='lobby'?'학생들이 입장하면 제시어와 스파이 인원을 정하고 시작하세요.':s.phase==='finished'?(s.result?.message||'라운드가 종료되었습니다.'):(s.paused?'⏸ 일시정지 중 · ':'▶ 진행 중 · ')+(s.phase==='final_guess'?'최종 추리 시간 60초':turn?`현재 차례: ${turn.name}`:'차례 없음');$('teacherTurn').textContent=turn?'현재 차례: '+turn.name:'';
 $('teacherSecret').textContent=playing?`교사 전용 | 제시어: ${s.word} · 스파이: ${s.spyIds.map(id=>s.players.find(p=>p.id===id)?.name).join(', ')}`:'';
 renderChat('teacherChat',s.chat);const roster=$('teacherPlayers');roster.replaceChildren(...s.players.map(p=>makePlayer(p,true,s.spyIds.includes(p.id)?'spy':null)));renderHighlight('teacherHighlight',s.highlight,'아직 설명이 없습니다.');const hist=$('teacherHistory');hist.replaceChildren(...[...s.history].reverse().map(h=>elem('div',null,h.message)));}
// A private, one-time role reveal per student and round. The ordinary screen never
// keeps role labels, role-specific art, or the secret word visible.
let roleRevealKey=null;
function roleSeenKey(s){return `spy-role-seen:${session.code}:${session.token}:${s.gameVersion||1}:${s.round}`;}
function syncRoleReveal(s){
 if((s.phase!=='playing'&&s.phase!=='final_guess')||!s.you?.role||!s.round){$('roleReveal').hidden=true;return;}
 const key=roleSeenKey(s);
 if(roleRevealKey===key)return;
 roleRevealKey=key;
 let seen=false;
 try{seen=sessionStorage.getItem(key)==='1';}catch(e){seen=false;}
 if(seen){$('roleReveal').hidden=true;return;}
 const spy=s.you.role==='spy';
 $('roleRevealArt').src=spy?'/assets/spy-character.png':'/assets/student-character.png';
 $('roleRevealArt').alt=spy?'스파이 캐릭터':'초등학생 캐릭터';
 $('roleRevealTitle').textContent=spy?'🕵️ 당신은 스파이입니다!':'🎓 당신은 일반학생입니다!';
 $('roleRevealSecret').textContent=spy?'제시어는 알려주지 않습니다. 설명을 듣고 추리하세요.':`비밀 제시어: ${s.you.word}`;
 $('roleReveal').hidden=false;
}
$('roleRevealConfirm').onclick=()=>{
 const s=session.state;
 if((s?.phase==='playing'||s?.phase==='final_guess')&&s.you?.role){
  try{sessionStorage.setItem(roleSeenKey(s),'1');}catch(e){}
 }
 $('roleReveal').hidden=true;
 maybeShowTurnReminder();
};
function closeWordPeek(){$('wordPeek').hidden=true;}
$('closeWordPeek').onclick=closeWordPeek;
$('checkWordBtn').onclick=()=>{
 const s=session.state;
 if(!s||session.mode!=='student'||(s.phase!=='playing'&&s.phase!=='final_guess')||!s.you?.role)return;
 // All students see an identical button. A spy never receives the word from the server.
 $('wordPeekMessage').textContent=s.you.role==='student'?`제시어: ${s.you.word}`:'제시어를 확인할 수 없습니다.';
 $('wordPeek').hidden=false;
};
// Show an identical, private reminder exactly once when this student gets a new turn.
// Remember the turn in this browser tab, so reconnects and chat state updates don't repeat it.
function currentTurnReminderKey(s){
 if(session.mode!=='student'||s?.phase!=='playing'||s.paused||s.you?.out||s.turnId!==s.you?.id)return null;
 return `spy-turn-notified:${session.code}:${session.token}:${s.gameVersion||1}:${s.round}:${s.turnId}`;
}
function maybeShowTurnReminder(){
 const s=session.state,key=currentTurnReminderKey(s);
 if(!key){$('turnReminder').hidden=true;return;}
 if(!$('turnReminder').hidden)return;
 // The private role-reveal popup has priority when a new round begins.
 if(!$('roleReveal').hidden||!$('resultPopup').hidden||!$('roundPopup').hidden)return;
 try{if(sessionStorage.getItem(key)==='1')return;}catch(e){}
 $('turnReminder').hidden=false;
 try{sessionStorage.setItem(key,'1');}catch(e){}
 playSound('clue');
}
$('dismissTurnReminder').onclick=()=>{
 $('turnReminder').hidden=true;
 const s=session.state;
 if(currentTurnReminderKey(s)){
   const input=$('clueInput');input.scrollIntoView({behavior:'smooth',block:'center'});
   input.focus({preventScroll:true});
 }
};
function renderStudent(){const s=session.state;if(!s)return;const you=s.you;renderChat('studentChat',s.chat);const canChat=s.phase!=='finished'&&!s.paused&&!you.out;$('chatInput').disabled=!canChat;$('chatBtn').disabled=!canChat;const playing=s.phase==='playing';const final=s.phase==='final_guess';const active=(playing||final)&&!s.paused&&!you.out;const yourTurn=s.turnId===you.id;const turn=s.players.find(p=>p.id===s.turnId);$('studentCode').textContent=s.code;$('checkWordBtn').disabled=!((playing||final)&&you.role);if(!playing&&!final)closeWordPeek();const role=$('roleCard');role.replaceChildren();role.className='roleCard identityCard';
 const myName=elem('button','roleTitle roleNameButton',`👤 ${you.name} ▾`);myName.type='button';myName.title='나의 비밀 정보 확인';myName.onclick=()=>{const current=session.state?.you;if(!current||session.state.phase==='lobby')return;const details=$('spyTeamContents');details.replaceChildren();if(current.role==='spy'){details.append(elem('p',null,'당신은 스파이입니다.'));const others=current.spyTeammates||[];if(others.length){details.append(elem('p',null,'같은 팀 스파이:'));for(const p of others)details.append(elem('div','spyFriend',`${p.name}${p.out?' (탈락)':''}`));}else details.append(elem('p',null,'이번 라운드에는 나 외에 다른 스파이가 없습니다.'));}else{details.append(elem('p',null,'당신은 일반학생입니다.'));details.append(elem('p',null,`제시어: ${current.word||''}`));}$('spyTeamModal').hidden=false;};role.append(myName);
 role.append(elem('p',null,s.phase==='lobby'?'게임 시작을 기다리고 있습니다.':'설명을 듣고 게임에 참여하세요. 제시어 확인 버튼은 모든 참가자에게 있습니다.'));
 syncRoleReveal(s);
 maybeShowTurnReminder();
 $('studentBanner').textContent=s.phase==='lobby'?'교사가 게임을 시작하기를 기다리고 있습니다.':s.phase==='finished'?(s.result?.message||'게임 종료')+(s.result?' · 정답: '+s.result.word:''):you.out?'🚫 아웃되었습니다. 점수와 진행 상황은 계속 볼 수 있습니다.':final?'⏳ 모든 설명이 끝났습니다. 스파이에게 마지막 60초의 추리 기회가 주어집니다.':s.paused?'⏸ 교사가 게임을 일시정지했습니다.':yourTurn?'✨ 지금 내 차례입니다. 설명을 작성하세요.':`현재 ${turn?.name||'다음 참가자'}의 차례입니다.`;
 $('turnIndicator').textContent=final?'최종 추리 60초':playing?(yourTurn?'내 차례':'대기 중'):s.phase==='lobby'?'대기실':'종료';$('clueBtn').disabled=!(active&&playing&&yourTurn);$('clueInput').disabled=!(active&&playing&&yourTurn);$('challengeBtn').disabled=!(active&&(playing||(final&&you.role==='spy')));$('challengeHint').textContent='챌린지는 익명으로 신청합니다. 실패하면 아웃될 수 있으니 신중하게 도전하세요.';
 renderHighlight('studentHighlight',s.highlight,'설명이 올라오면 이곳에 크게 표시됩니다.');const clues=$('clueList');clues.replaceChildren(...s.clues.map(c=>{const line=elem('div','clue');line.append(elem('b',null,c.name),elem('small',null,'설명'));line.append(elem('div',null,c.text));return line;}));if(!s.clues.length)clues.append(elem('p','muted','아직 등록된 설명이 없습니다.'));
 $('studentPlayers').replaceChildren(...s.players.map(p=>makePlayer(p)));const result=$('studentResult');result.hidden=s.phase!=='finished';if(s.phase==='finished'){result.replaceChildren(elem('h2',null,'🏁 라운드 결과'),elem('p',null,s.result?.message||'종료'),elem('p',null,'정답: '+(s.result?.word||'')),elem('p',null,'스파이: '+(s.result?.spies.map(p=>p.name).join(', ')||'')));const ranking=elem('div');ranking.id='studentRankings';result.append(ranking);addRanks('studentRankings',s.result?.leaderboard);}}
$('clueForm').onsubmit=e=>{e.preventDefault();const text=$('clueInput').value.trim();request('student:clue',{code:session.code,token:session.token,text},()=>{$('clueInput').value='';toast('설명이 전체 학생에게 표시되었습니다.');});};
function closeModal(){$('modal').hidden=true;}$('closeModal').onclick=closeModal;$('cancelChallenge').onclick=closeModal;
$('challengeBtn').onclick=()=>{const s=session.state;if(!s||(s.phase!=='playing'&&s.phase!=='final_guess')||s.paused||s.you.out||(s.phase==='final_guess'&&s.you.role!=='spy'))return;const spy=s.you.role==='spy';$('modalTitle').textContent=spy?'🕵️ 제시어 맞히기':'🎯 스파이 지목하기';$('modalHelp').textContent=spy?'챌린지는 익명입니다. 제시어 정답 기회는 총 2회이며, 두 번째 오답 때만 정체가 공개되고 아웃됩니다.':'익명으로 스파이를 지목합니다. 정답이면 스파이만 공개되고 본인 +1점, 오답이면 내 이름이 공개되고 아웃됩니다.';const options=$('modalOptions');options.replaceChildren();if(spy){const input=elem('input');input.id='guessWord';input.maxLength=40;input.placeholder='정답 제시어 입력';options.append(input);}else{const candidates=s.players.filter(p=>!p.out&&p.id!==s.you.id);candidates.forEach(p=>{const label=elem('label','option');const radio=elem('input');radio.type='radio';radio.name='target';radio.value=p.id;label.append(radio,elem('span',null,p.name));options.append(label);});if(!candidates.length)options.append(elem('p','muted','지목 가능한 학생이 없습니다.'));}$('modal').hidden=false;};
$('submitChallenge').onclick=()=>{const s=session.state;if(!s)return;const spy=s.you.role==='spy';const word=spy?$('guessWord')?.value.trim():null;const targetId=spy?null:document.querySelector('input[name=target]:checked')?.value;if(s.phase==='final_guess'&&s.finalGuessDeadline&&s.finalGuessDeadline<=Date.now()+clockOffset)return toast('최종 추리 시간이 종료되었습니다.');if(spy&&!word)return toast('예상 제시어를 입력하세요.');if(!spy&&!targetId)return toast('지목할 학생을 선택하세요.');if(!confirm(spy?'제시어를 제출할까요? 첫 오답은 비공개이고 두 번째 오답이면 아웃됩니다.':'챌린지를 확정하시겠습니까? 틀리면 아웃됩니다.'))return;request('student:challenge',{code:session.code,token:session.token,word,targetId},closeModal);};

// Refresh the synchronized final-guess countdown following state changes.

$('closeSpyTeam').onclick=()=>{$('spyTeamModal').hidden=true;};
